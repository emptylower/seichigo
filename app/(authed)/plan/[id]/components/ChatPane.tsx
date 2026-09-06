'use client'

import { RotateCcw } from 'lucide-react'
import type { TripPlanDayView } from '@/lib/tripPlan/view'
import type { AskUserPayload } from '@/lib/planAgent/askUser'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { TierHints } from '@/hooks/useUsage'
import { planTextFor } from '../lib/planText'
import { AskAnswerChip, AskCard, type AskAnswer } from './AskCard'
import { DayCards, DaymapCard } from './DayCards'
import { MarkdownBubble } from './MarkdownBubble'
import { ThinkingChain, type ThinkingTurn } from './ThinkingChain'
import type { AgentPostBody, ChatEntry, ModelNotice } from '../lib/chatState'

// busy 为 true 但首帧遥测尚未到达时的兜底（startedAt 不影响进行中态展示）
const EMPTY_THINKING_TURN: ThinkingTurn = { reasoning: '', statusPhrase: null, toolCalls: [], startedAt: 0 }

/**
 * 单列对话流（从 ui.tsx 拆出，纯搬运）：恢复/停止/续跑横幅 + 消息列表
 * （MarkdownBubble / AskCard / DaymapCard / 思维链挂载）+ 跟随滚动锚点 +
 * 仅有存量计划时的 legacy「当前计划」副本。所有状态仍由 ui.tsx 持有。
 */
export function ChatPane(props: {
  planId: string
  chat: ChatEntry[]
  days: TripPlanDayView[]
  busy: boolean
  /** 断线恢复 / 跨标签页恢复横幅 */
  syncBanner: 'reconnecting' | 'in-progress' | null
  /** B1 用户主动停止本轮 */
  stopped: boolean
  onResumeAfterStop: () => void
  /** 断线续跑横幅 */
  resumeBanner: 'resuming' | 'done' | 'manual' | null
  onResume: () => void
  /** 历史思维链展开键（`m${idx}`）；null 为全部收起 */
  expandedThinking: string | null
  onToggleHistoryThinking: (key: string) => void
  /** 进行中的思维链 */
  activeThinking: ThinkingTurn | null
  activeExpanded: boolean
  onToggleActiveThinking: () => void
  /** run 被打断后、续跑流尚未吐出遥测前的兜底短语 */
  interrupted: boolean
  modelNotice: ModelNotice | null
  onComposeDraft: (text: string) => void
  onAnswerAsk: (ask: AskUserPayload, answer: AskAnswer) => void
  onRetry: (retry: AgentPostBody) => void
  chatEndRef: React.RefObject<HTMLDivElement | null>
  /** 档位差异提示开关（设计 §4）：ui.tsx 的单个 useUsage 向下传给每张行程卡 */
  tierHints?: TierHints | null
  locale?: SupportedLocale
}) {
  const { chat, busy } = props
  const locale = props.locale ?? 'zh'
  const tx = planTextFor(locale)
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 space-y-3 px-4 pb-40 pt-2">
      {/* 断线/跨页恢复横幅：标题行下方的圆角提示条，宽度随对话列 */}
      {props.syncBanner ? (
        <div
          role="status"
          className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2 text-center text-xs text-amber-700"
        >
          {tx(props.syncBanner === 'reconnecting' ? 'chat.bannerReconnecting' : 'chat.bannerInProgress')}
        </div>
      ) : null}
      {/* B1 停止横幅：用户主动停止本轮规划，复用「继续」的 {resume:true} 逻辑 */}
      {props.stopped ? (
        <div
          role="status"
          className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-center text-xs text-gray-600"
        >
          <span className="inline-flex items-center gap-2">
            {tx('chat.stoppedBanner')}
            <button
              type="button"
              disabled={busy}
              onClick={props.onResumeAfterStop}
              className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2.5 py-0.5 font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              {tx('common.continue')}
            </button>
          </span>
        </div>
      ) : null}
      {/* 断线续跑横幅：自动续跑进行中 / 无可续内容（淡出）/ 本会话已续过（手动继续） */}
      {props.resumeBanner === 'done' ? (
        <div
          role="status"
          className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2 text-center text-xs text-gray-500"
        >
          {tx('chat.resumeDone')}
        </div>
      ) : props.resumeBanner ? (
        <div
          role="status"
          className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2 text-center text-xs text-amber-700"
        >
          {props.resumeBanner === 'resuming' ? (
            tx('chat.resumingAuto')
          ) : (
            <span className="inline-flex items-center gap-2">
              {tx('chat.resumeInterrupted')}
              <button
                type="button"
                disabled={busy}
                onClick={props.onResume}
                className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-0.5 font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                {tx('common.continue')}
              </button>
            </span>
          )}
        </div>
      ) : null}
      {chat.length === 0 ? (
        <p className="text-sm text-gray-400">{tx('chat.emptyHint')}</p>
      ) : null}
      {chat.map((entry, idx) => {
        // daymap 交付物：聊天时间线里的独立条目（不可变快照，只读渲染）
        if (entry.daymap) {
          return (
            <DaymapCard
              key={`daymap-${entry.daymap.revisionId}`}
              planId={props.planId}
              daymap={entry.daymap}
              onComposeDraft={props.onComposeDraft}
              tierHints={props.tierHints ?? null}
              locale={locale}
            />
          )
        }
        if (entry.role === 'user') {
          return (
            <div
              key={idx}
              className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-brand-50 px-4 py-2 text-sm text-gray-900"
            >
              {entry.text}
            </div>
          )
        }
        const ask = entry.ask
        // ask 是最后一条 → 可交互组件；否则说明已有后续对话，折叠成摘要 chip
        const isLast = idx === chat.length - 1
        return (
          <div key={idx} className="space-y-2">
            {entry.thinking ? (
              <ThinkingChain
                thinking={entry.thinking}
                active={false}
                expanded={props.expandedThinking === `m${idx}`}
                onToggle={() => props.onToggleHistoryThinking(`m${idx}`)}
                locale={locale}
              />
            ) : null}
            {ask ? (
              isLast ? (
                <AskCard
                  payload={ask}
                  // ask 事件到达时本轮 SSE 可能尚未完全关闭（busy 仍为 true），
                  // 此时禁用交互防止提交被 postAndStream 的 busy 守卫静默丢弃
                  disabled={busy}
                  onSubmit={(answer) => props.onAnswerAsk(ask, answer)}
                  locale={locale}
                />
              ) : (
                <AskAnswerChip payload={ask} answerText={chat[idx + 1]?.text ?? entry.text} />
              )
            ) : entry.text || entry.retry ? (
              <div className="max-w-[92%] rounded-2xl bg-gray-50 px-4 py-2 text-sm text-gray-800">
                <MarkdownBubble text={entry.text} />
                {entry.retry ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => props.onRetry(entry.retry!)}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-50 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    {tx('common.retry')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
      {busy ? (
        <ThinkingChain
          thinking={props.activeThinking ?? EMPTY_THINKING_TURN}
          active
          // run 被打断（live 空 + interrupted 非空）后、续跑流尚未吐出遥测前，
          // 兜底短语显示「已中断」而不是「思考中」
          idlePhrase={props.interrupted ? tx('thinking.interrupted') : undefined}
          // §0 model_info：供应商不回显思考增量时的头部灰字提示
          modelNotice={props.modelNotice}
          // 生成中自动展开（有实质内容时），本轮结束后随消息定格自动收起；
          // 用户在本轮内可手动收起/展开，下一轮自动复位
          expanded={props.activeExpanded}
          onToggle={props.onToggleActiveThinking}
          followScroll
          locale={locale}
        />
      ) : null}

      {/* 跟随滚动锚点：daymap 交付物在聊天流内按时间线渲染（见 chat.map），
          锚点保持在流末尾；仅有存量计划、尚无任何 daymap 消息时才在锚点后
          渲染一次"legacy 当前计划"副本——一旦出现真实 daymap 就不再渲染，
          避免同一行程出现两份且旧图被新保存覆盖 */}
      <div ref={props.chatEndRef} />

      {!chat.some((entry) => entry.daymap) && props.days.length > 0 ? (
        <div className="pt-4">
          <DayCards
            planId={props.planId}
            days={props.days}
            scope="current"
            onComposeDraft={props.onComposeDraft}
            tierHints={props.tierHints ?? null}
            locale={locale}
          />
        </div>
      ) : null}
    </div>
  )
}
