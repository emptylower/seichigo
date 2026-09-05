import OpenAI from 'openai'
import type { Prisma } from '@prisma/client'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'
import { resolveLlmForScope, type ResolvedLlm } from '@/lib/llm/registry'
import { LlmEmptyStreamError, LlmHttpError } from '@/lib/llm/client'
import { createReasoningExtractor } from '@/lib/llm/reasoningExtract'
import { isUserStoppedAbort, userStoppedAbort } from './stop'
import type { CreateMessageFn, PlanAgentChatMessage } from './loop'
import { isTransientNetworkError } from './netErrors'

const MODEL = process.env.PLAN_AGENT_MODEL || 'deepseek-v4-flash'
const BASE_URL = process.env.PLAN_AGENT_BASE_URL || 'https://api.deepseek.com'

/**
 * 单次模型调用的输出预算（reasoning + content + tool call JSON 共享）。
 * save_plan_days 要求一次性输出整份行程，7 天规模的 tool call JSON 本身就
 * 有数千 token；预算太小会把参数在半截截断成非法 JSON，是"参数格式传错"
 * 的结构性来源。推理模型的 reasoning 同样计入这份预算——实测卡住的计划
 * 最后一轮 reasoning 会在 16k 附近浮动，部分运行把预算吃光后正文 0 字、
 * 工具调用 0 个（finish_reason=length 的"空回合"），因此默认抬高到 32k
 * （已实测 DeepSeek 接受 max_tokens=32768）。可通过 PLAN_AGENT_MAX_TOKENS
 * 覆盖（个别模型上限更低时）。
 */
const MAX_OUTPUT_TOKENS = Number(process.env.PLAN_AGENT_MAX_TOKENS) || 32_768

let cachedClient: OpenAI | null = null

function getClient(): OpenAI {
  if (!cachedClient) {
    if (!process.env.PLAN_AGENT_API_KEY) {
      throw new Error('PLAN_AGENT_API_KEY 未配置')
    }
    cachedClient = new OpenAI({ apiKey: process.env.PLAN_AGENT_API_KEY, baseURL: BASE_URL })
  }
  return cachedClient
}

/**
 * 流式调用对瞬时网络错误的重试预算。workerd 出站 fetch 被底层中断时抛
 * 平台原生 "Network connection lost."（见 netErrors.ts），官方 agents SDK
 * 也把它归类为"可就地重试的瞬时错误"。重试安全性：模型调用本身零副作用，
 * assistant 消息落库发生在循环层拿到完整返回之后，工具写入也都在之前
 * 的迭代里各自落库——重试只是重新发起"这一次模型调用"。代价：重试会
 * 从头重新流式输出，已透传的 reasoning 增量会在实时思维链里重复出现
 * （仅瞬时遥测，不落库，可接受）。
 */
const STREAM_MAX_ATTEMPTS = 3

/** 连接建立后立刻关闭、一个 chunk 都没产出：同样按可重试的传输失败处理。 */
class EmptyStreamError extends Error {
  constructor() {
    super('模型未返回消息')
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type AccumulatedToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** 单次流式尝试：建立连接、消费整个流、累积重建完整 message。 */
async function attemptStreamOnce(
  messages: Parameters<CreateMessageFn>[0]['messages'],
  tools: Parameters<CreateMessageFn>[0]['tools'],
  onDelta?: (delta: { reasoning?: string; content?: string }) => void,
  signal?: AbortSignal,
): Promise<PlanAgentChatMessage> {
  const stream = await getClient().chat.completions.create(
    {
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages,
      tools,
      stream: true,
    },
    // A3 停止：loop 传入的 signal（租约看守触发停止时 abort）真正传到 SDK
    signal ? { signal } : undefined,
  )

  let content = ''
  let reasoning = ''
  let finishReason: string | null | undefined
  const toolCalls = new Map<number, AccumulatedToolCall>()
  // A2：统一思考增量口径（reasoning_content / reasoning / reasoning_details /
  // content 内嵌 <think> 标签），与 lib/llm/openaiClient.ts 共用同一实现
  const extractor = createReasoningExtractor()
  // 等价恢复非流式时代的 if (!message) throw 保护：连一个 chunk 都没产出
  // （连接建立后立刻关闭、空响应体等）意味着上游从未真正给出响应，必须报错，
  // 否则会伪装成一条合法的空 assistant 消息被当作正常回合落库。
  let sawAnyChunk = false

  for await (const chunk of stream) {
    sawAnyChunk = true
    const choice = chunk.choices[0]
    if (!choice) continue
    const delta = choice.delta
    // 记录最后一个非空 finish_reason（流式协议里通常只有末帧携带；
    // length=被输出预算截断、stop=正常结束，循环层据此区分"主动结束"
    // 与"预算耗尽"，至少可供日志与后续策略使用）
    if (choice.finish_reason) finishReason = choice.finish_reason

    const { reasoning: reasoningDelta, content: contentDelta } = extractor.consume(delta ?? {})
    if (reasoningDelta) {
      reasoning += reasoningDelta
      onDelta?.({ reasoning: reasoningDelta })
    }

    if (contentDelta) {
      content += contentDelta
      onDelta?.({ content: contentDelta })
    }

    for (const part of delta.tool_calls ?? []) {
      const existing = toolCalls.get(part.index)
      if (!existing) {
        toolCalls.set(part.index, {
          id: part.id ?? '',
          type: 'function',
          function: {
            name: part.function?.name ?? '',
            arguments: part.function?.arguments ?? '',
          },
        })
      } else {
        if (part.id) existing.id = part.id
        if (part.function?.name) existing.function.name = part.function.name
        if (part.function?.arguments) existing.function.arguments += part.function.arguments
      }
    }
  }

  // M1：流结束但 signal 已 abort（SDK/中转可能把 abort 后的流收尾成正常
  // 结束）——必须按用户停止抛出，不能把半截流伪装成一次成功调用落库
  if (signal?.aborted) throw userStoppedAbort()
  if (!sawAnyChunk) throw new EmptyStreamError()

  // 流结束：吐出挂起的"疑似半截 <think> 标签"尾巴（按当前状态归类）
  const tail = extractor.flush()
  if (tail.content) content += tail.content
  if (tail.reasoning) reasoning += tail.reasoning

  const rebuiltToolCalls = [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
  // 镜像 DeepSeek 非流式响应里 message 自带 reasoning_content 的形状；loop
  // 落库/回传历史时本来就只保留协议字段，不会把它写进 TripPlanMessage
  const message: PlanAgentChatMessage = {
    role: 'assistant',
    content: content || null,
    refusal: null,
    ...(rebuiltToolCalls.length ? { tool_calls: rebuiltToolCalls } : {}),
    ...(reasoning ? { reasoning_content: reasoning } : {}),
    ...(finishReason !== undefined ? { finish_reason: finishReason } : {}),
  }
  return message
}

/**
 * 流式版模型调用：按 OpenAI 流式协议增量累积 content 与 tool_calls（tool_calls
 * 按 index 归并，function.arguments 是需要拼接的 JSON 字符串片段），并透传
 * DeepSeek 的 reasoning_content 增量给 onDelta。返回累积重建后的完整 message，
 * 形状与非流式响应一致（reasoning_content 同样附在返回值上，由调用方决定去留）。
 *
 * 模型来源优先级：管理面板里接管 agent 的自定义供应商（lib/llm/registry，
 * openai/anthropic 两种协议的统一客户端）→ 环境变量 PLAN_AGENT_*（OpenAI SDK）。
 *
 * 重试守卫对两条模型来源路径一致生效：瞬时网络错误（workerd
 * "Network connection lost." 等，见 netErrors.ts）、空流、以及供应商路径的
 * LlmHttpError 429/408/5xx（上游限流/瞬时过载）就地重试本次调用；其余错误
 * （参数/鉴权/4xx）原样抛出，不做无差别重试。
 */
export const createChatCompletion: CreateMessageFn = async ({ messages, tools, signal }, onDelta) => {
  // 测试可通过 env 把退避压到 1ms（调用时读取，避免模块加载顺序问题）
  const backoffMs = Number(process.env.PLAN_AGENT_STREAM_RETRY_BACKOFF_MS) || 500
  let lastError: unknown
  for (let attempt = 0; attempt < STREAM_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(backoffMs * attempt)
    try {
      const provider = await resolveLlmForScope('agent')
      if (provider) {
        const message = await provider.client.streamChat(
          {
            model: provider.model,
            messages,
            tools,
            maxTokens: provider.maxOutputTokens,
            // A3 停止：LlmChatInput.signal 一路传到 HTTP 层（此前未传）
            ...(signal ? { signal } : {}),
          },
          onDelta,
        )
        lastReturnedMessage = attachProviderUsage(message, providerUsageOf(provider))
        return lastReturnedMessage
      }
      lastReturnedMessage = await attemptStreamOnce(messages, tools, onDelta, signal)
      return lastReturnedMessage
    } catch (err) {
      // A3 停止：user_stopped abort 是确定性指令，绝不重试
      if (isUserStoppedAbort(err)) throw err
      // M1：abort 可能以其它错误形态冒出（SDK 包装的连接错误等）——signal
      // 已 abort 就按用户停止立即抛出，不再消耗重试预算
      if (signal?.aborted) throw userStoppedAbort()
      lastError = err
      if (!isRetryableStreamError(err)) throw err
    }
  }
  throw lastError
}

/**
 * 重试判定：空流（连接建立后立即关闭）与瞬时网络错误之外，供应商路径的
 * LlmHttpError 429/408/5xx 同样视为可重试的瞬时失败（与 env 路径对齐）；
 * 其余 4xx（参数/鉴权类）重试无意义，立即抛出。
 */
function isRetryableStreamError(err: unknown): boolean {
  if (err instanceof EmptyStreamError || err instanceof LlmEmptyStreamError) return true
  if (err instanceof LlmHttpError) {
    return err.status === 429 || err.status === 408 || err.status >= 500
  }
  return isTransientNetworkError(err)
}

/** M4 运行日志的 modelUsage 形状（TripPlanRunLog.modelUsage 列）。 */
export type PlanAgentModelUsage = {
  providerId: string
  providerName: string
  model: string
  protocol: string
}

function providerUsageOf(provider: ResolvedLlm): PlanAgentModelUsage {
  return {
    providerId: provider.providerId,
    providerName: provider.providerName,
    model: provider.model,
    protocol: provider.protocol,
  }
}

type WithProviderUsage = PlanAgentChatMessage & { provider?: PlanAgentModelUsage }

/**
 * 把本次调用实际使用的供应商挂在返回消息上（不可枚举：loop 落库时本就只保留
 * 协议字段，这里再挡一层，保证任何 JSON 序列化路径都不会把它带进 TripPlanMessage）。
 */
function attachProviderUsage(
  message: PlanAgentChatMessage,
  usage: PlanAgentModelUsage,
): PlanAgentChatMessage {
  Object.defineProperty(message, 'provider', {
    value: usage,
    enumerable: false,
    writable: false,
    configurable: true,
  })
  return message
}

/** 最近一次 createChatCompletion 的返回值（供应商信息从它身上读，不再用独立全局变量）。 */
let lastReturnedMessage: PlanAgentChatMessage | null = null

function providerUsageOfMessage(message: PlanAgentChatMessage | null): PlanAgentModelUsage | null {
  return (message as WithProviderUsage | null)?.provider ?? null
}

/**
 * 第十一轮 A3（§0）：本次模型调用的展示信息（model_info 事件用）。接管供应
 * 商时读返回消息上附着的 provider（非枚举字段）；env 路径（PLAN_AGENT_*）
 * 没有供应商信息，回退为 providerName='默认模型'（L3：'env' 是内部路径名，
 * 不该出现在面向用户的提示里）+ 环境变量模型名。
 */
export function describePlanAgentModel(message: PlanAgentChatMessage | null): { providerName: string; model: string } {
  const usage = providerUsageOfMessage(message)
  if (usage) return { providerName: usage.providerName, model: usage.model }
  return { providerName: '默认模型', model: MODEL }
}

/**
 * 包装 TripPlanRepo：把 appendRunLog 的 modelUsage 补成本 run 实际使用的
 * 供应商信息（loop.ts 固定写 null，由 route 装配 deps 时套上这一层）。
 * 读取来源是最近一次 createChatCompletion 的返回消息（其 provider 字段按
 * 调用附着，env 路径的返回不带该字段 → null）。其余方法原样透传（绑定回
 * target 保证 this 正确）。
 */
export function withModelUsageInRunLog<T extends TripPlanRepo>(repo: T): T {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop === 'appendRunLog') {
        return async (entry: Parameters<TripPlanRepo['appendRunLog']>[0]) => {
          const usage = providerUsageOfMessage(lastReturnedMessage)
          return target.appendRunLog(
            usage ? { ...entry, modelUsage: usage as unknown as Prisma.JsonValue } : entry,
          )
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * 标题侧信道的独立轻量调用：无工具、小 max_tokens，与主 agent loop 并行。
 * 注意 PLAN_AGENT_MODEL 是推理模型，reasoning 也要消耗 completion 预算
 * （实测一个标题约耗 400+ reasoning tokens），额度太小会导致 content 为空。
 * 返回 null 表示这次没有可用标题（内容缺失或清洗后为空）。
 * 有接管供应商时走统一客户端 completeText；环境变量路径行为不变。
 */
export async function generatePlanTitle(userMessage: string, signal?: AbortSignal): Promise<string | null> {
  const titleSystem =
    '根据用户的巡礼规划请求生成不超过 12 字的计划标题，只输出标题文字本身，不要引号，不要以标点符号结尾。'

  const provider = await resolveLlmForScope('agent')
  if (provider) {
    const text = await provider.client.completeText({
      model: provider.model,
      system: titleSystem,
      prompt: userMessage.slice(0, 500),
      maxTokens: 1024,
      signal,
    })
    return typeof text === 'string' && text ? cleanPlanTitle(text) : null
  }

  const completion = await getClient().chat.completions.create(
    {
      model: MODEL,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: titleSystem },
        { role: 'user', content: userMessage.slice(0, 500) },
      ],
    },
    signal ? { signal } : undefined,
  )
  const text = completion.choices[0]?.message?.content
  if (typeof text !== 'string') return null
  return cleanPlanTitle(text)
}

/** 标题清洗：剥首尾引号与收尾标点，截断到 80 字。 */
function cleanPlanTitle(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/^["'“”«»《]+/, '')
    .replace(/["'“”«»》.。!！?？,，、;；:：~～-]+$/, '')
    .trim()
  if (!cleaned) return null
  return cleaned.slice(0, 80)
}
