'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
import { planText, planTextFor, type PlanTextFn } from '../lib/planText'
import { useSmoothText } from '../hooks/useSmoothText'
import type { WatchConnectionState } from '../hooks/useAgentWatchStream'

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

/** 任务 B：同一帧快照到达的多条工具行按此间隔逐条出现（仅进行中的回合） */
const TOOL_ROW_STAGGER_MS = 80

/**
 * 每秒 tick 的已用秒数（C1/C3 共用）：重渲染局部化在使用它的小组件里，
 * 不把 now 提升到 ThinkingChain 顶层 state 上拖整棵树每秒重渲染。
 */
function useElapsedSeconds(since: number): number {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.floor((Date.now() - since) / 1000)))
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - since) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [since])
  return seconds
}

/**
 * C1 active pill 上的「· 已用 12s」：本地计时，不依赖网络——网断了它照样走，
 * 正好把「模型慢」和「画面冻结」区分开。
 */
function ElapsedTick({ startedAt, tx }: { startedAt: number; tx: PlanTextFn }) {
  const seconds = useElapsedSeconds(startedAt)
  return <span className="shrink-0 text-brand-400">· {tx('thinking.elapsedLive', { seconds })}</span>
}

/** C3 工具行 running 态的本地已用秒数；服务端 durationMs 到达后仍以服务端值为准 */
function RunningElapsed({ since }: { since: number }) {
  const seconds = useElapsedSeconds(since)
  return <span className="shrink-0 text-gray-400">{seconds}s</span>
}

function ToolCallRow({ call, runningSince }: { call: ToolCallEntry; runningSince?: number }) {
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
          {call.status === 'running' && typeof runningSince === 'number' ? (
            <RunningElapsed since={runningSince} />
          ) : typeof call.durationMs === 'number' ? (
            <span className="shrink-0 text-gray-400">{formatDuration(call.durationMs)}</span>
          ) : null}
        </div>
        {call.resultSummary ? <p className="text-xs text-gray-500">{call.resultSummary}</p> : null}
      </div>
    </div>
  )
}

/** 展开态时间线：reasoning 流 + 工具调用列表（进行中/历史回看复用） */
function ThinkingTimeline({
  thinking,
  active,
  followScroll,
  shownCount,
  firstSeenAt,
}: {
  thinking: ThinkingTurn
  /** active=false 的历史回看：reasoning 直接全量显示，不看打字机重放 */
  active: boolean
  followScroll?: boolean
  /** 已揭示的工具行数（ThinkingChain 持有，跨展开/收起保持） */
  shownCount: number
  /** 每条工具行首见时刻（ThinkingChain 持有，跨展开/收起保持） */
  firstSeenAt: Map<string, number>
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const followScrollRef = useRef(followScroll)
  useEffect(() => {
    followScrollRef.current = followScroll
  }, [followScroll])

  // 自动滚动跟随：和打字机走同一个 rAF tick（文字与滚动同步移动）；只在用户
  // 已经贴近底部时才跟随，用户手动上滚看历史时不把他拽回去
  const followBottom = useCallback(() => {
    if (!followScrollRef.current) return
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  // 打字机播放缓冲：渲染节奏与 500ms 全量快照的到达节奏解耦
  const renderedReasoning = useSmoothText(thinking.reasoning, { done: !active, onFrame: followBottom })

  // 任务 B 错开插入：只对进行中的回合把同帧到达的多条工具行按 ~80ms 逐条放出；
  // 历史回看挂载即全量。slice 只影响「新行出现时机」——已显示行渲染的仍是
  // thinking.toolCalls 里的最新对象，running→done 同 id 更新立即生效，不被队列延迟。
  // shownCount 与 firstSeenAt 由 ThinkingChain 层持有并传入：本组件随 expanded
  // 卸载/重挂，状态不能在本地，否则收起再展开会重放错开动画、running 计时归零
  const visibleCalls = active ? thinking.toolCalls.slice(0, shownCount) : thinking.toolCalls

  // 单一滚动容器（收敛原先内外两层互相打架的 overflow）；reasoning 区常驻 +
  // 约两行高的 min-h 占位，避免框子凭空长出来的首帧布局跳动
  return (
    <div ref={scrollRef} className="max-h-[50dvh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-3">
      <div className="min-h-10 whitespace-pre-wrap text-xs italic leading-relaxed text-gray-500">
        {renderedReasoning}
      </div>
      <div className="divide-y divide-gray-50">
        {visibleCalls.map((call) => (
          <ToolCallRow key={call.id} call={call} runningSince={active ? firstSeenAt.get(call.id) : undefined} />
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
  /** C2 观察流连接状态：degraded 时 pill 换成「连接不稳，重试中」并压暗 spinner */
  connectionState?: WatchConnectionState
  locale?: SupportedLocale
}) {
  const { thinking, active, expanded, onToggle } = props
  const tx = planTextFor(props.locale ?? 'zh')
  const degraded = props.connectionState === 'degraded'

  // 任务 B 错开揭示进度 + C3 首见时刻：ThinkingChain 不随展开/收起卸载（只有
  // timeline 是条件渲染），状态放在这一层才能跨展开保持——收起再展开时已揭示的
  // 行立即全量显示，running 行的已用时长连续，不重放 80ms 错开动画
  const [shownCount, setShownCount] = useState(() => (active ? 0 : thinking.toolCalls.length))
  const firstSeenAtRef = useRef(new Map<string, number>())

  // 新回合开始时重置揭示进度与首见时刻，否则上一轮的揭示进度会漏到新一轮。
  // 回合更替的判定：active false→true（新回合开始）、active true→false（回合结束）、
  // 或 inactive 状态下 startedAt 变化（历史回合被替换）都算新回合；唯独 active
  // 持续为 true 时的 startedAt 漂移不算——恢复轮询的 live 快照会为同一进行中的
  // 回合带入新的 startedAt，此时揭示进度与 running 计时必须连续。
  // render 期派生重置（React 推荐模式）：子树尚未渲染，不会闪出一帧旧进度
  const [mark, setMark] = useState({ startedAt: thinking.startedAt, active })
  if (mark.startedAt !== thinking.startedAt || mark.active !== active) {
    const driftWhileActive = mark.active && active
    setMark({ startedAt: thinking.startedAt, active })
    if (!driftWhileActive) {
      setShownCount(active ? 0 : thinking.toolCalls.length)
      firstSeenAtRef.current = new Map()
    }
  }

  // 80ms 步进器：只对进行中的回合把同帧到达的多条工具行逐条放出；active=false
  // 立即全量。卸载/下一轮推进时清掉未执行的 timeout
  useEffect(() => {
    if (!active) {
      setShownCount(thinking.toolCalls.length)
      return
    }
    if (shownCount >= thinking.toolCalls.length) return
    const timer = window.setTimeout(() => {
      setShownCount((cur) => Math.min(cur + 1, thinking.toolCalls.length))
    }, TOOL_ROW_STAGGER_MS)
    return () => window.clearTimeout(timer)
  }, [active, thinking.toolCalls.length, shownCount])

  // C3：每条工具行首次进入本时间线数据的本地时刻（ref 记录，幂等），running 行计时用
  for (const call of thinking.toolCalls) {
    if (!firstSeenAtRef.current.has(call.id)) firstSeenAtRef.current.set(call.id, Date.now())
  }

  const timeline = expanded ? (
    <ThinkingTimeline
      thinking={thinking}
      active={active}
      followScroll={props.followScroll}
      shownCount={shownCount}
      firstSeenAt={firstSeenAtRef.current}
    />
  ) : null

  if (active) {
    // 宁可告诉用户网络在抖，也别让他盯着一个假装在转的 spinner
    const phrase = degraded
      ? tx('thinking.reconnecting')
      : thinking.statusPhrase ?? props.idlePhrase ?? tx('thinking.thinking')
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="relative flex items-center gap-2 overflow-hidden rounded-full border border-brand-100 bg-brand-50/60 px-3 py-1.5 text-xs text-brand-700"
        >
          <Loader2 className={`h-3.5 w-3.5 shrink-0 animate-spin ${degraded ? 'opacity-40' : ''}`} />
          <span key={phrase} className="plan-phrase-in">
            {phrase}
          </span>
          {thinking.startedAt > 0 ? <ElapsedTick startedAt={thinking.startedAt} tx={tx} /> : null}
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
