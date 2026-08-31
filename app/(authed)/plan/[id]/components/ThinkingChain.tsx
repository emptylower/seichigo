'use client'

import {
  BookOpen,
  CalendarCheck,
  Check,
  ChevronDown,
  Footprints,
  Loader2,
  MapPin,
  Pencil,
  Route,
  Search,
  Tv,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'

/** 单个工具调用的展示条目（与 SSE tool_call 事件同形） */
export type ToolCallEntry = {
  id: string
  name: string
  argsSummary: string
  status: 'running' | 'done'
  durationMs?: number
  resultSummary?: string
}

/**
 * 一轮 assistant 回合的"思维链"数据：从上一条 assistant 消息（或发送）到
 * 下一条 text 事件之间收到的所有 status/reasoning/tool_call 遥测的累积。
 * 仅存在于客户端内存，不落库（服务端这些事件本就是瞬时遥测）。
 */
export type ThinkingTurn = {
  reasoning: string
  statusPhrase: string | null
  toolCalls: ToolCallEntry[]
  startedAt: number
  endedAt?: number
}

export function newThinkingTurn(now = Date.now()): ThinkingTurn {
  return { reasoning: '', statusPhrase: null, toolCalls: [], startedAt: now }
}

/** 是否累积了值得展示的内容（只有过 status 短语的回合视为空） */
export function hasThinkingContent(turn: ThinkingTurn): boolean {
  return turn.toolCalls.length > 0 || turn.reasoning.trim().length > 0
}

/** 把一帧遥测事件累积进进行中的思维链（纯函数，便于测试） */
export function applyThinkingEvent(turn: ThinkingTurn, event: PlanAgentEvent): ThinkingTurn {
  switch (event.type) {
    case 'status':
      return { ...turn, statusPhrase: event.phase }
    case 'reasoning':
      return { ...turn, reasoning: turn.reasoning + event.delta }
    case 'tool_call': {
      const entry: ToolCallEntry = {
        id: event.id,
        name: event.name,
        argsSummary: event.argsSummary,
        status: event.status,
        durationMs: event.durationMs,
        resultSummary: event.resultSummary,
      }
      const idx = turn.toolCalls.findIndex((t) => t.id === event.id)
      if (idx < 0) return { ...turn, toolCalls: [...turn.toolCalls, entry] }
      // 同 id 的 done 帧更新 running 帧插入的那一条
      const toolCalls = turn.toolCalls.slice()
      toolCalls[idx] = { ...toolCalls[idx], ...entry }
      return { ...turn, toolCalls }
    }
    default:
      return turn
  }
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  search_anime: Search,
  search_bangumi_tv: Tv,
  list_points: MapPin,
  cluster_points: Route,
  estimate_transit: Footprints,
  read_plan: BookOpen,
  update_plan_meta: Pencil,
  save_plan_days: CalendarCheck,
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

function ToolCallRow({ call }: { call: ToolCallEntry }) {
  const Icon = TOOL_ICONS[call.name] ?? Wrench
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {call.status === 'running' ? (
          <Icon className="h-3.5 w-3.5 animate-pulse text-brand-500" />
        ) : (
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-medium text-gray-700">{call.argsSummary || call.name}</span>
          {typeof call.durationMs === 'number' ? (
            <span className="shrink-0 text-gray-400">{formatDuration(call.durationMs)}</span>
          ) : null}
        </div>
        {call.resultSummary ? <p className="text-xs text-gray-500">{call.resultSummary}</p> : null}
      </div>
    </div>
  )
}

/** 展开态时间线：reasoning 流 + 工具调用列表（进行中/历史回看复用） */
function ThinkingTimeline({ thinking }: { thinking: ThinkingTurn }) {
  return (
    <div className="max-h-[50dvh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-3">
      {thinking.reasoning.trim() ? (
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs italic leading-relaxed text-gray-500">
          {thinking.reasoning}
        </div>
      ) : null}
      <div className="divide-y divide-gray-50">
        {thinking.toolCalls.map((call) => (
          <ToolCallRow key={call.id} call={call} />
        ))}
      </div>
    </div>
  )
}

/**
 * 思维链组件三段式生命周期：
 * - active=true：进行中的工作状态条（loader + 当前短语 + shimmer + 可展开）
 * - active=false：回合结束定格的一行小字摘要 + "查看思考过程"回看入口
 */
export function ThinkingChain(props: {
  thinking: ThinkingTurn
  active: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const { thinking, active, expanded, onToggle } = props
  const timeline = expanded ? <ThinkingTimeline thinking={thinking} /> : null

  if (active) {
    const phrase = thinking.statusPhrase ?? '规划师思考中…'
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="relative flex items-center gap-2 overflow-hidden rounded-full border border-brand-100 bg-brand-50/60 px-3 py-1.5 text-xs text-brand-700"
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span key={phrase} className="plan-phrase-in">
            {phrase}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          <span aria-hidden="true" className="plan-shimmer pointer-events-none absolute inset-0" />
        </button>
        {timeline}
      </div>
    )
  }

  if (!hasThinkingContent(thinking)) return null
  const steps = thinking.toolCalls.length
  const secs =
    typeof thinking.endedAt === 'number' ? Math.max(0, Math.round((thinking.endedAt - thinking.startedAt) / 1000)) : null
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400">
        {steps > 0 ? `已完成 ${steps} 步` : '已完成思考'}
        {secs != null ? ` · 用时 ${secs}s` : ''}
        {' · '}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="cursor-pointer text-brand-500 underline decoration-dotted underline-offset-2"
        >
          {expanded ? '收起思考过程' : '查看思考过程'}
        </button>
      </p>
      {timeline}
    </div>
  )
}
