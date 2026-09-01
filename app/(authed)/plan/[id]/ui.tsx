'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, MoreHorizontal, RotateCcw, SendHorizontal } from 'lucide-react'
import type { ChatEntryView, TripPlanView } from '@/lib/tripPlan/view'
import type { AskUserPayload } from '@/lib/planAgent/askUser'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { AskAnswerChip, AskCard } from './components/AskCard'
import { DayCards } from './components/DayCards'
import { MarkdownBubble } from './components/MarkdownBubble'
import {
  ThinkingChain,
  applyThinkingEvent,
  hasThinkingContent,
  newThinkingTurn,
  type ThinkingTurn,
} from './components/ThinkingChain'

type ChatEntry = ChatEntryView & { thinking?: ThinkingTurn; retryMessage?: string }

const NEAR_BOTTOM_THRESHOLD_PX = 80
const TEXTAREA_MAX_HEIGHT_PX = 128 // ≈ 4 行
// busy 为 true 但首帧遥测尚未到达时的兜底（startedAt 不影响进行中态展示）
const EMPTY_THINKING_TURN: ThinkingTurn = { reasoning: '', statusPhrase: null, toolCalls: [], startedAt: 0 }

export function PlanPlanner(props: { planId: string; initialPlan: TripPlanView; initialChat: ChatEntryView[] }) {
  const [plan, setPlan] = useState(props.initialPlan)
  const [chat, setChat] = useState<ChatEntry[]>(props.initialChat)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeThinking, setActiveThinking] = useState<ThinkingTurn | null>(null)
  // 展开哪条历史思维链：`m${idx}`（消息定格）——纯 UI 状态，不参与跟随滚动
  const [expandedThinking, setExpandedThinking] = useState<string | null>(null)
  // 进行中思维链默认自动展开；用户在本轮内手动点收起后置 true，下一轮自动复位
  const [activeCollapsed, setActiveCollapsed] = useState(false)
  const [selectedDay, setSelectedDay] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function refreshPlan() {
    const res = await fetch(`/api/me/plans/${props.planId}`)
    if (!res.ok) return
    const body = (await res.json()) as { plan?: TripPlanView }
    if (body.plan) setPlan(body.plan)
  }

  function handleScroll() {
    const el = scrollRef.current
    const end = chatEndRef.current
    if (!el || !end) return
    // "在底部"的语义 = 对话流的末尾（chatEndRef）在视口底沿附近。
    // 不能用量滚动容器绝对底部：DayCards 行程卡片在锚点之后且很高，
    // 滚到对话末尾时离容器底部还差整个行程的高度，会被误判为"不在底部"而停止跟随。
    const distanceToChatEnd = end.getBoundingClientRect().top - el.getBoundingClientRect().bottom
    nearBottomRef.current = distanceToChatEnd < NEAR_BOTTOM_THRESHOLD_PX
  }

  // 仅当用户视口本就在底部附近时才跟随滚动，避免翻看历史时被拽回底部
  useEffect(() => {
    if (!nearBottomRef.current) return
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat, busy, plan.days.length])

  // textarea 自适应高度（≤4 行，超出内部滚动）
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [input])

  async function postAndStream(body: { message: string; answerTo?: string; answerValue?: unknown }) {
    if (busy) return
    setBusy(true)
    // 用户主动发送时强制跟随到底部（常规 chat 行为）
    nearBottomRef.current = true
    setChat((prev) => [...prev, { role: 'user', text: body.message }])
    // 本轮思维链累积器：本地变量跨帧累积（state 更新是异步的），state 只负责实时渲染
    let turn = newThinkingTurn()
    setActiveThinking(turn)
    setExpandedThinking(null)
    setActiveCollapsed(false)

    // 定格当前累积的思维链并开启下一段（多轮"模型→工具"循环时每段 text 各挂一份）
    const freezeTurn = (): ThinkingTurn | undefined => {
      const frozen = { ...turn, endedAt: Date.now() }
      turn = newThinkingTurn()
      setActiveThinking(turn)
      return hasThinkingContent(frozen) ? frozen : undefined
    }

    try {
      const res = await fetch(`/api/me/plans/${props.planId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok || !res.body) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null
        // 普通消息失败给重试入口；ask 结构化回答重发语义复杂，不给
        setChat((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: errBody?.error ?? '请求失败，请稍后再试',
            retryMessage: body.answerTo ? undefined : body.message,
          },
        ])
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const line = frame.trim()
          if (!line.startsWith('data:')) continue
          let event: PlanAgentEvent
          try {
            event = JSON.parse(line.slice(5)) as PlanAgentEvent
          } catch {
            continue
          }
          switch (event.type) {
            case 'text': {
              const thinking = freezeTurn()
              setChat((prev) => [...prev, { role: 'assistant', text: event.text, thinking }])
              break
            }
            case 'ask': {
              // ask_user 结构化提问：本体挂 ask 字段，prompt 同时作 text 降级展示；
              // 本轮对话就此结束（后端随后会发 done）
              const thinking = freezeTurn()
              const ask: AskUserPayload = {
                askId: event.askId,
                kind: event.kind,
                prompt: event.prompt,
                options: event.options,
                allowSkip: event.allowSkip,
              }
              setChat((prev) => [...prev, { role: 'assistant', text: event.prompt, ask, thinking }])
              break
            }
            case 'plan_updated':
              await refreshPlan()
              break
            case 'error': {
              const thinking = freezeTurn()
              // 偶发网络/运行时错误：附重试入口，用户不必手打重发（仅普通消息）
              setChat((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  text: `出错了：${event.message}`,
                  thinking,
                  retryMessage: body.answerTo ? undefined : body.message,
                },
              ])
              break
            }
            case 'done': {
              // 回合末尾仍残留未挂接的遥测（最后一段只有工具调用没有正文）时，
              // 挂到最近一条还没有思维链的 assistant 消息上
              const frozen = { ...turn, endedAt: Date.now() }
              turn = newThinkingTurn()
              if (hasThinkingContent(frozen)) {
                setChat((prev) => {
                  const next = [...prev]
                  for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].role === 'assistant' && !next[i].thinking) {
                      next[i] = { ...next[i], thinking: frozen }
                      return next
                    }
                  }
                  return next
                })
              }
              break
            }
            case 'status':
            case 'reasoning':
            case 'tool_call':
              turn = applyThinkingEvent(turn, event)
              setActiveThinking(turn)
              break
          }
        }
      }
    } finally {
      setBusy(false)
      setActiveThinking(null)
    }
  }

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setInput('')
    await postAndStream({ message })
  }

  // 进行中思维链的自动展开态：有实质遥测内容且用户本轮未手动收起
  const activeAutoExpanded = busy && activeThinking != null && hasThinkingContent(activeThinking) && !activeCollapsed

  return (
    <div data-layout-wide="true" data-layout-immersive="true" className="flex h-dvh flex-col">
      {/* 自绘极简顶栏（站点 header/footer 已由 data-layout-immersive 隐藏） */}
      <header className="h-14 shrink-0 border-b border-pink-100/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-full w-full max-w-3xl items-center gap-3 px-4">
          <Link
            href="/plan"
            aria-label="返回计划列表"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-600 no-underline transition hover:bg-pink-50 hover:text-brand-600"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="flex-1 truncate text-sm font-semibold text-gray-900">{plan.title}</h1>
          <button
            type="button"
            aria-label="更多操作"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-pink-50 hover:text-brand-600"
            onClick={() => window.alert('更多操作即将上线')}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* 单列对话流：消息 + 行程预览 + 地图在同一个滚动容器里 */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6">
          {chat.length === 0 ? (
            <p className="text-sm text-gray-400">
              试试：“帮我安排下个月中旬去京都，做京吹圣地巡礼的 3 天计划”
            </p>
          ) : null}
          {chat.map((entry, idx) => {
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
                    expanded={expandedThinking === `m${idx}`}
                    onToggle={() => setExpandedThinking((cur) => (cur === `m${idx}` ? null : `m${idx}`))}
                  />
                ) : null}
                {ask ? (
                  isLast ? (
                    <AskCard
                      payload={ask}
                      // ask 事件到达时本轮 SSE 可能尚未完全关闭（busy 仍为 true），
                      // 此时禁用交互防止提交被 postAndStream 的 busy 守卫静默丢弃
                      disabled={busy}
                      onSubmit={(answer) =>
                        void postAndStream({ message: answer.readableText, answerTo: ask.askId, answerValue: answer.answerValue })
                      }
                    />
                  ) : (
                    <AskAnswerChip payload={ask} answerText={chat[idx + 1]?.text ?? entry.text} />
                  )
                ) : (
                  <div className="max-w-[92%] rounded-2xl bg-gray-50 px-4 py-2 text-sm text-gray-800">
                    <MarkdownBubble text={entry.text} />
                    {entry.retryMessage ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void postAndStream({ message: entry.retryMessage! })}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-50 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        重试
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
          {busy ? (
            <ThinkingChain
              thinking={activeThinking ?? EMPTY_THINKING_TURN}
              active
              // 生成中自动展开（有实质内容时），本轮结束后随消息定格自动收起；
              // 用户在本轮内可手动收起/展开，下一轮自动复位
              expanded={activeAutoExpanded}
              onToggle={() => setActiveCollapsed(activeAutoExpanded)}
              followScroll
            />
          ) : null}

          {/* 跟随滚动锚点必须在 DayCards 之前：行程卡片很高，锚点若在其后，
              新消息/ask 卡片会被埋进行程上方、滚出视口（移动端上表现为"组件没弹出来"） */}
          <div ref={chatEndRef} />

          {plan.days.length > 0 ? (
            <div className="pt-4">
              <DayCards plan={plan} planId={props.planId} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
            </div>
          ) : null}
        </div>
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-pink-100/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="告诉规划师你的巡礼想法…（Enter 发送，Shift+Enter 换行）"
            className="max-h-32 flex-1 resize-none overflow-y-auto rounded-2xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-brand-400"
          />
          <button
            type="button"
            aria-label="发送"
            disabled={busy || !input.trim()}
            onClick={() => void send()}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
