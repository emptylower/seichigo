/**
 * 计划页对话状态的纯逻辑（从 ui.tsx 抽出，便于单测且给 ui.tsx 腾出行数预算）：
 * 客户端 ChatEntry 形状、/agent 请求体、运行实况映射与「以服务端为准」的整体合并。
 */
import type { ChatEntryView } from '@/lib/tripPlan/view'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import type { ThinkingTurn, ToolCallEntry } from '../components/ThinkingChain'

export type ChatEntry = ChatEntryView & {
  thinking?: ThinkingTurn
  /** 出错轮记录完整请求体（普通轮/答复轮/续跑轮一致），重试按钮原样重发 */
  retry?: AgentPostBody
}

/** POST /agent 请求体：普通/答复轮带 message；续跑轮只带 resume（不追加 human 消息） */
export type AgentPostBody = { message: string; answerTo?: string; answerValue?: unknown } | { resume: true }

/** §0 契约：上一次 run 被客户端断开打断的标记（GET /api/me/plans/:id 返回） */
export type InterruptedInfo = { at: string; turnIndex: number }

/**
 * §0 契约（第十一轮）：后端新增的两个 SSE 事件。lib 侧类型由 A 部分并行合入，
 * 前端先按契约在本地声明，合入后并集不变。
 */
export type PlanStreamEvent =
  | PlanAgentEvent
  | { type: 'stopped' }
  | { type: 'model_info'; providerName: string; model: string; reasoning: boolean }

/** 当前模型不公开思考过程时的提示（model_info.reasoning === false） */
export type ModelNotice = { providerName: string; model: string }

/** §0.1 契约：agentBusy 时 GET /api/me/plans/:id 额外返回的运行实况快照 */
export type PlanRunLive = {
  runToken?: string
  reasoning?: string
  statusText?: string | null
  toolCalls?: Array<{ name?: string; status?: string; summary?: string }>
  updatedAt?: string
}

/** 自动续跑去重键：sessionStorage 记 planId:turnIndex，同一页面会话只自动续一次 */
export function autoResumeStorageKey(planId: string): string {
  return `planAutoResume:${planId}`
}

/** 把恢复轮询拿到的 live 快照映射成与流式一致的 ThinkingTurn（id 按序稳定，跨轮询不重排） */
export function liveToThinkingTurn(live: PlanRunLive, prev: ThinkingTurn | null): ThinkingTurn {
  const toolCalls: ToolCallEntry[] = (Array.isArray(live.toolCalls) ? live.toolCalls : []).map((call, index) => ({
    id: `live-${index}-${call.name ?? 'tool'}`,
    name: call.name ?? 'tool',
    argsSummary: call.summary ?? '',
    status: call.status === 'running' ? 'running' : call.status === 'error' ? 'error' : 'done',
  }))
  return {
    reasoning: typeof live.reasoning === 'string' ? live.reasoning : '',
    statusPhrase: typeof live.statusText === 'string' && live.statusText ? live.statusText : null,
    toolCalls,
    startedAt: prev?.startedAt ?? Date.now(),
  }
}

function sameChatEntry(local: ChatEntry, server: ChatEntryView): boolean {
  if (local.role !== server.role || local.text !== server.text) return false
  if (local.daymap || server.daymap) return local.daymap?.revisionId === server.daymap?.revisionId
  return true
}

/**
 * 以服务端落库 chat 为准整体替换本地列表：内容匹配的条目携带回客户端仅有的
 * thinking/retry 字段（断线恢复时保留已渲染的思维链）；daymap 按 revisionId
 * 去重兜底。取代旧的"只追加序号大于计数的条目"脆弱逻辑。
 */
export function mergeServerChat(prev: ChatEntry[], server: ChatEntryView[]): ChatEntry[] {
  const used = new Set<number>()
  const merged: ChatEntry[] = server.map((entry, index) => {
    const direct = prev[index]
    if (direct && !used.has(index) && sameChatEntry(direct, entry)) {
      used.add(index)
      return { ...entry, thinking: direct.thinking, retry: direct.retry }
    }
    const found = prev.findIndex((local, i) => !used.has(i) && sameChatEntry(local, entry))
    if (found >= 0) {
      used.add(found)
      return { ...entry, thinking: prev[found]!.thinking, retry: prev[found]!.retry }
    }
    return entry
  })
  const seenRevisions = new Set<string>()
  return merged.filter((entry) => {
    if (!entry.daymap) return true
    if (seenRevisions.has(entry.daymap.revisionId)) return false
    seenRevisions.add(entry.daymap.revisionId)
    return true
  })
}

/**
 * 把定格的思维链挂到最后一条还没有思维链的 assistant 消息上（回合末尾只有工具
 * 调用没有正文时的兜底）。M5：`appendIfNone` 用于「已停止」——没有可挂载的
 * assistant 消息时独立追加一条（只有思维链、无正文），让停止在历史里留痕。
 */
export function attachThinkingToLast(
  prev: ChatEntry[],
  thinking: ThinkingTurn,
  options?: { appendIfNone?: boolean },
): ChatEntry[] {
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i]!.role !== 'assistant' || prev[i]!.thinking) continue
    const next = prev.slice()
    next[i] = { ...next[i]!, thinking }
    return next
  }
  return options?.appendIfNone ? [...prev, { role: 'assistant', text: '', thinking }] : prev
}
