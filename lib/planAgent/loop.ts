import type OpenAI from 'openai'
import type { Prisma } from '@prisma/client'
import { executePlanTool, PLAN_AGENT_TOOLS, type PlanAgentToolDeps } from './tools'
import { PLAN_AGENT_SYSTEM_PROMPT } from './prompt'
import { RunFencedError } from './runFence'
import { summarizeToolArgs, summarizeToolResult, toolStatusPhrase } from './statusPhrases'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'

export type PlanAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'plan_updated' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  /** 瞬时遥测：当前工具在做什么的中文短语（仅 SSE，不落库） */
  | { type: 'status'; phase: string }
  /** 瞬时遥测：单个工具调用的开始/结束帧（仅 SSE，不落库） */
  | { type: 'tool_call'; id: string; name: string; argsSummary: string; status: 'running' | 'done'; durationMs?: number; resultSummary?: string }
  /** 瞬时遥测：DeepSeek reasoning_content 的流式增量（仅 SSE，不落库） */
  | { type: 'reasoning'; delta: string }

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam

/**
 * 模型调用增量回调：reasoning/content 是本帧收到的增量片段本身（非累积值）。
 * 只接受一个参数的实现仍然可以赋给本类型（多余形参可不声明），存量 mock 不受影响。
 */
export type CreateMessageFn = (
  params: {
    messages: ChatMessageParam[]
    tools: OpenAI.Chat.Completions.ChatCompletionTool[]
  },
  onDelta?: (delta: { reasoning?: string; content?: string }) => void,
) => Promise<OpenAI.Chat.Completions.ChatCompletionMessage>

export type PlanAgentDeps = {
  createMessage: CreateMessageFn
  repo: TripPlanRepo
  planId: string
  toolDeps: PlanAgentToolDeps
  maxIterations?: number
  signal?: AbortSignal
  /** 路由已在配额事务里落库人类消息时置 true，历史里已含该消息，循环不再重复 push/落库 */
  userMessagePersisted?: boolean
  /**
   * beginAgentRun 返回的持有者 token。传入后循环在每轮模型调用返回时都会
   * 用它做栅栏检查（fencing）——busy 位的 TTL 只是启发式，本请求可能仍然
   * 存活，只是模型响应慢；一旦发现自己已被新请求接管就立刻停止写入，避免
   * 与新请求交叉写同一份历史。不传时不做检查（供内部测试等不涉及并发场
   * 景的调用方使用）。
   */
  runToken?: string
}

/**
 * 把 repo 的写方法（appendMessage/replaceDays/updateMeta）替换成 token 校验
 * 过的原子版本；校验失败时抛 RunFencedError 而不是静默返回，因为调用点
 * 分散在循环主体和 tools.ts 的工具执行器里，抛异常是唯一能统一从任意调用
 * 深度冒泡回循环顶层的方式。其余方法原样透传（绑定回 target 以保证内部
 * this 正确，与 lib/db/prisma.ts 的 Proxy 用法一致）。
 */
function withFencing(repo: TripPlanRepo, token: string): TripPlanRepo {
  const fenced: Pick<TripPlanRepo, 'appendMessage' | 'replaceDays' | 'updateMeta'> = {
    async appendMessage(planId, kind, content) {
      const result = await repo.appendMessageIfActive(planId, token, kind, content)
      if (!result) throw new RunFencedError()
      return result
    },
    async replaceDays(planId, days) {
      const result = await repo.replaceDaysIfActive(planId, token, days)
      if (!result) throw new RunFencedError()
      return result
    },
    async updateMeta(planId, patch) {
      const result = await repo.updateMetaIfActive(planId, token, patch)
      if (!result) throw new RunFencedError()
      return result
    },
  }
  return new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop in fenced) return fenced[prop as keyof typeof fenced]
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const DEFAULT_MAX_ITERATIONS = 12

function isChatMessage(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'role' in value
}

/**
 * 修复损坏的历史再回放：带 tool_calls 的 assistant 消息必须紧跟全部对应的
 * tool 回执，否则 OpenAI 协议回放会被拒。崩溃或历史并发交错会留下悬空
 * tool_calls / 孤儿 tool 回执——不清理的话该计划的后续对话会永久报错。
 */
export function sanitizeChatHistory(history: ChatMessageParam[]): ChatMessageParam[] {
  const out: ChatMessageParam[] = []
  for (let i = 0; i < history.length; i++) {
    const msg = history[i]
    if (msg.role === 'tool') continue // 走到这的 tool 都是孤儿（配对的在下面整组消费）
    const toolCalls = msg.role === 'assistant' && 'tool_calls' in msg ? msg.tool_calls ?? [] : []
    if (msg.role === 'assistant' && toolCalls.length) {
      const pending = new Set(toolCalls.map((c) => c.id))
      const replies: ChatMessageParam[] = []
      let j = i + 1
      while (j < history.length && history[j].role === 'tool') {
        const reply = history[j] as Extract<ChatMessageParam, { role: 'tool' }>
        if (pending.delete(reply.tool_call_id)) replies.push(reply)
        j++
      }
      if (pending.size === 0) out.push(msg, ...replies)
      i = j - 1
      continue
    }
    out.push(msg)
  }
  return out
}

export async function runPlanAgent(
  deps: PlanAgentDeps,
  userMessage: string,
  onEvent: (event: PlanAgentEvent) => void,
): Promise<void> {
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS

  const history = await deps.repo.listMessages(deps.planId)
  const messages: ChatMessageParam[] = [
    { role: 'system', content: PLAN_AGENT_SYSTEM_PROMPT },
    ...sanitizeChatHistory(
      history
        .map((m) => m.content)
        .filter(isChatMessage)
        .map((m) => m as unknown as ChatMessageParam),
    ),
  ]

  if (!deps.userMessagePersisted) {
    const userParam: ChatMessageParam = { role: 'user', content: userMessage }
    messages.push(userParam)
    await deps.repo.appendMessage(deps.planId, 'human', userParam as unknown as Prisma.JsonValue)
  }

  // runToken 存在时，所有写（含 save_plan_days/update_plan_meta 等工具触发
  // 的写）都走原子校验版本；未提供 token 的调用方（不涉及并发场景的测试）
  // 直接用裸 repo
  const runRepo = deps.runToken ? withFencing(deps.repo, deps.runToken) : deps.repo

  const toolDeps: PlanAgentToolDeps = {
    ...deps.toolDeps,
    repo: runRepo,
    onPlanUpdated: () => {
      deps.toolDeps.onPlanUpdated?.()
      onEvent({ type: 'plan_updated' })
    },
  }

  try {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (deps.signal?.aborted) break
      // reasoning 增量逐帧透传给 SSE（content 增量不转发：最终答案等本轮结束后
      // 仍走下面那个完整 text 事件，这是"思考过程流式、答案整段"的产品取舍）
      const response = await deps.createMessage({ messages, tools: PLAN_AGENT_TOOLS }, (delta) => {
        if (delta.reasoning) onEvent({ type: 'reasoning', delta: delta.reasoning })
      })

      if (typeof response.content === 'string' && response.content) {
        onEvent({ type: 'text', text: response.content })
      }

      // DeepSeek 推理模型响应带 reasoning_content，回传历史与落库前只保留协议字段
      const assistantParam = {
        role: 'assistant' as const,
        content: response.content ?? null,
        ...(response.tool_calls?.length ? { tool_calls: response.tool_calls } : {}),
      }
      messages.push(assistantParam as ChatMessageParam)
      await runRepo.appendMessage(deps.planId, 'assistant', assistantParam as unknown as Prisma.JsonValue)

      const toolCalls = response.tool_calls ?? []
      if (!toolCalls.length) break

      for (const call of toolCalls) {
        if (call.type !== 'function') continue
        let input: unknown = {}
        try {
          input = JSON.parse(call.function.arguments || '{}')
        } catch {
          input = {}
        }
        const argsSummary = summarizeToolArgs(call.function.name, input)
        // status/tool_call 事件只发 SSE，是瞬时遥测，绝不写进 TripPlanMessage
        onEvent({ type: 'status', phase: toolStatusPhrase(call.function.name, input) })
        onEvent({ type: 'tool_call', id: call.id, name: call.function.name, argsSummary, status: 'running' })
        const startedAt = Date.now()
        const result = await executePlanTool(toolDeps, call.function.name, input)
        onEvent({
          type: 'tool_call',
          id: call.id,
          name: call.function.name,
          argsSummary,
          status: 'done',
          durationMs: Date.now() - startedAt,
          resultSummary: summarizeToolResult(call.function.name, result),
        })
        const toolParam: ChatMessageParam = { role: 'tool', tool_call_id: call.id, content: result }
        messages.push(toolParam)
        await runRepo.appendMessage(deps.planId, 'tool', toolParam as unknown as Prisma.JsonValue)
      }
    }
  } catch (err) {
    if (!(err instanceof RunFencedError)) {
      // 已被新请求接管，静默结束——不是真正的错误，new 请求会接手对话
      const message = err instanceof Error ? err.message : String(err)
      onEvent({ type: 'error', message })
    }
  }

  onEvent({ type: 'done' })
}
