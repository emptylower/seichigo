import type OpenAI from 'openai'
import type { Prisma } from '@prisma/client'
import { executePlanTool, PLAN_AGENT_TOOLS, type PlanAgentToolDeps } from './tools'
import { PLAN_AGENT_SYSTEM_PROMPT } from './prompt'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'

export type PlanAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'plan_updated' }
  | { type: 'done' }
  | { type: 'error'; message: string }

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam

export type CreateMessageFn = (params: {
  messages: ChatMessageParam[]
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
}) => Promise<OpenAI.Chat.Completions.ChatCompletionMessage>

export type PlanAgentDeps = {
  createMessage: CreateMessageFn
  repo: TripPlanRepo
  planId: string
  toolDeps: PlanAgentToolDeps
  maxIterations?: number
  signal?: AbortSignal
  /** 路由已在配额事务里落库人类消息时置 true，历史里已含该消息，循环不再重复 push/落库 */
  userMessagePersisted?: boolean
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

  const toolDeps: PlanAgentToolDeps = {
    ...deps.toolDeps,
    onPlanUpdated: () => {
      deps.toolDeps.onPlanUpdated?.()
      onEvent({ type: 'plan_updated' })
    },
  }

  try {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (deps.signal?.aborted) break
      const response = await deps.createMessage({ messages, tools: PLAN_AGENT_TOOLS })

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
      await deps.repo.appendMessage(deps.planId, 'assistant', assistantParam as unknown as Prisma.JsonValue)

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
        const result = await executePlanTool(toolDeps, call.function.name, input)
        const toolParam: ChatMessageParam = { role: 'tool', tool_call_id: call.id, content: result }
        messages.push(toolParam)
        await deps.repo.appendMessage(deps.planId, 'tool', toolParam as unknown as Prisma.JsonValue)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onEvent({ type: 'error', message })
  }

  onEvent({ type: 'done' })
}
