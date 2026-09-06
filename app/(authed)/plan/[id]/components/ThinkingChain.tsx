'use client'

import { useEffect, useRef } from 'react'
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
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import type { SupportedLocale } from '@/lib/i18n/types'
import { planText, planTextFor } from '../lib/planText'

/** 单个工具调用的展示条目（与 SSE tool_call 事件同形；恢复轮询的 live 快照可带 error 态） */
export type ToolCallEntry = {
  id: string
  name: string
  argsSummary: string
  status: 'running' | 'done' | 'error'
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

/** M5：用户主动停止本轮时定格用的状态短语（定格态摘要行显示它而不是「已完成」） */
export function stoppedPhrase(locale: SupportedLocale = 'zh'): string {
  return planText(locale, 'thinking.stopped')
}

/** 中文常量：既有 import 与历史落库快照仍按中文比对 */
export const STOPPED_PHRASE = stoppedPhrase('zh')

/** 定格短语是不是「已停止」——三语任一命中即算（站点语言可能与定格时不同） */
export function isStoppedPhrase(phrase: string | null | undefined): boolean {
  if (!phrase) return false
  return (['zh', 'en', 'ja'] as const).some((locale) => stoppedPhrase(locale) === phrase)
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
        ) : call.status === 'error' ? (
          <XCircle className="h-3.5 w-3.5 text-rose-500" />
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
function ThinkingTimeline({ thinking, followScroll }: { thinking: ThinkingTurn; followScroll?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const reasoningRef = useRef<HTMLDivElement>(null)

  // 流式生成中内容自动滚动跟随到最新（仅思维链内部小容器，与页面整体滚动策略无关）
  useEffect(() => {
    if (!followScroll) return
    const container = containerRef.current
    if (container) container.scrollTop = container.scrollHeight
    const reasoning = reasoningRef.current
    if (reasoning) reasoning.scrollTop = reasoning.scrollHeight
  }, [followScroll, thinking.reasoning, thinking.toolCalls])

  return (
    <div ref={containerRef} className="max-h-[50dvh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-3">
      {thinking.reasoning.trim() ? (
        <div
          ref={reasoningRef}
          className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs italic leading-relaxed text-gray-500"
        >
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
  /** 进行中流式内容自动滚动跟随到最新（仅 active 场景传入） */
  followScroll?: boolean
  /** 无状态短语时的兜底文案（断线中断场景传「已中断」） */
  idlePhrase?: string
  /**
   * §0 model_info：当前模型不回显思考增量时的头部提示（reasoning=false）。
   * 刷新恢复（live 快照）路径没有该信息，此时传 null 即不显示。
   */
  modelNotice?: { providerName: string; model: string } | null
  locale?: SupportedLocale
}) {
  const { thinking, active, expanded, onToggle } = props
  const tx = planTextFor(props.locale ?? 'zh')
  const timeline = expanded ? <ThinkingTimeline thinking={thinking} followScroll={props.followScroll} /> : null

  if (active) {
    const phrase = thinking.statusPhrase ?? props.idlePhrase ?? tx('thinking.thinking')
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
        {props.modelNotice ? (
          <p className="px-1 text-[11px] leading-4 text-gray-400">
            {tx('thinking.modelNotice', { provider: props.modelNotice.providerName, model: props.modelNotice.model })}
          </p>
        ) : null}
        {timeline}
      </div>
    )
  }

  // M5：被用户停止的回合即使没攒下遥测也要留痕（摘要行显示「已停止」）
  const stopped = isStoppedPhrase(thinking.statusPhrase)
  const reviewable = hasThinkingContent(thinking)
  if (!reviewable && !stopped) return null
  const steps = thinking.toolCalls.length
  const secs =
    typeof thinking.endedAt === 'number' ? Math.max(0, Math.round((thinking.endedAt - thinking.startedAt) / 1000)) : null
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400">
        {stopped ? tx('thinking.stopped') : steps > 0 ? tx('thinking.doneSteps', { steps }) : tx('thinking.doneThinking')}
        {secs != null ? ` · ${tx('thinking.elapsed', { seconds: secs })}` : ''}
        {reviewable ? (
          <>
            {' · '}
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="cursor-pointer text-brand-500 underline decoration-dotted underline-offset-2"
            >
              {expanded ? tx('thinking.collapse') : tx('thinking.expand')}
            </button>
          </>
        ) : null}
      </p>
      {reviewable ? timeline : null}
    </div>
  )
}
