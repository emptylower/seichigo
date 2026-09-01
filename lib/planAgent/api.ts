import OpenAI from 'openai'
import type { CreateMessageFn } from './loop'
import { isTransientNetworkError } from './netErrors'

const MODEL = process.env.PLAN_AGENT_MODEL || 'deepseek-v4-flash'
const BASE_URL = process.env.PLAN_AGENT_BASE_URL || 'https://api.deepseek.com'

/**
 * 单次模型调用的输出预算（reasoning + content + tool call JSON 共享）。
 * save_plan_days 要求一次性输出整份行程，7 天规模的 tool call JSON 本身就
 * 有数千 token；预算太小会把参数在半截截断成非法 JSON，是"参数格式传错"
 * 的结构性来源。可通过 PLAN_AGENT_MAX_TOKENS 覆盖（个别模型上限更低时）。
 */
const MAX_OUTPUT_TOKENS = Number(process.env.PLAN_AGENT_MAX_TOKENS) || 16_384

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

/**
 * DeepSeek 推理模型的非标准扩展字段：流式时挂在 chunk 的 delta 上、非流式时挂在
 * message 上，OpenAI SDK 类型均未声明。收敛到这一个断言点，其余代码只读它。
 */
type WithReasoningContent = { reasoning_content?: string | null }

function extractReasoningDelta(delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta): string {
  const value = (delta as WithReasoningContent).reasoning_content
  return typeof value === 'string' ? value : ''
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
): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
  const stream = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages,
    tools,
    stream: true,
  })

  let content = ''
  let reasoning = ''
  const toolCalls = new Map<number, AccumulatedToolCall>()
  // 等价恢复非流式时代的 if (!message) throw 保护：连一个 chunk 都没产出
  // （连接建立后立刻关闭、空响应体等）意味着上游从未真正给出响应，必须报错，
  // 否则会伪装成一条合法的空 assistant 消息被当作正常回合落库。
  let sawAnyChunk = false

  for await (const chunk of stream) {
    sawAnyChunk = true
    const choice = chunk.choices[0]
    if (!choice) continue
    const delta = choice.delta

    const reasoningDelta = extractReasoningDelta(delta)
    if (reasoningDelta) {
      reasoning += reasoningDelta
      onDelta?.({ reasoning: reasoningDelta })
    }

    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
      onDelta?.({ content: delta.content })
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

  if (!sawAnyChunk) throw new EmptyStreamError()

  const rebuiltToolCalls = [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
  // 镜像 DeepSeek 非流式响应里 message 自带 reasoning_content 的形状；loop
  // 落库/回传历史时本来就只保留协议字段，不会把它写进 TripPlanMessage
  const message: OpenAI.Chat.Completions.ChatCompletionMessage & { reasoning_content?: string } = {
    role: 'assistant',
    content: content || null,
    refusal: null,
    ...(rebuiltToolCalls.length ? { tool_calls: rebuiltToolCalls } : {}),
    ...(reasoning ? { reasoning_content: reasoning } : {}),
  }
  return message
}

/**
 * 流式版模型调用：按 OpenAI 流式协议增量累积 content 与 tool_calls（tool_calls
 * 按 index 归并，function.arguments 是需要拼接的 JSON 字符串片段），并透传
 * DeepSeek 的 reasoning_content 增量给 onDelta。返回累积重建后的完整 message，
 * 形状与非流式响应一致（reasoning_content 同样附在返回值上，由调用方决定去留）。
 *
 * 瞬时网络错误（workerd "Network connection lost." 等，见 netErrors.ts）时
 * 整体重试本次调用；非网络类错误（参数/鉴权/配额、以及空流语义错误耗尽后）
 * 原样抛出，不做无差别重试。
 */
export const createChatCompletion: CreateMessageFn = async ({ messages, tools }, onDelta) => {
  // 测试可通过 env 把退避压到 1ms（调用时读取，避免模块加载顺序问题）
  const backoffMs = Number(process.env.PLAN_AGENT_STREAM_RETRY_BACKOFF_MS) || 500
  let lastError: unknown
  for (let attempt = 0; attempt < STREAM_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(backoffMs * attempt)
    try {
      return await attemptStreamOnce(messages, tools, onDelta)
    } catch (err) {
      lastError = err
      // 空流（连接建立后立即关闭）同样视为传输层瞬时失败；其余非网络错误立即抛出
      if (!(err instanceof EmptyStreamError) && !isTransientNetworkError(err)) throw err
    }
  }
  throw lastError
}

/**
 * 标题侧信道的独立轻量调用：无工具、小 max_tokens，与主 agent loop 并行。
 * 注意 PLAN_AGENT_MODEL 是推理模型，reasoning 也要消耗 completion 预算
 * （实测一个标题约耗 400+ reasoning tokens），额度太小会导致 content 为空。
 * 返回 null 表示这次没有可用标题（内容缺失或清洗后为空）。
 */
export async function generatePlanTitle(userMessage: string, signal?: AbortSignal): Promise<string | null> {
  const completion = await getClient().chat.completions.create(
    {
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content:
            '根据用户的巡礼规划请求生成不超过 12 字的计划标题，只输出标题文字本身，不要引号，不要以标点符号结尾。',
        },
        { role: 'user', content: userMessage.slice(0, 500) },
      ],
    },
    signal ? { signal } : undefined,
  )
  const text = completion.choices[0]?.message?.content
  if (typeof text !== 'string') return null
  const cleaned = text
    .trim()
    .replace(/^["'“”«»《]+/, '')
    .replace(/["'“”«»》.。!！?？,，、;；:：~～-]+$/, '')
    .trim()
  if (!cleaned) return null
  return cleaned.slice(0, 80)
}
