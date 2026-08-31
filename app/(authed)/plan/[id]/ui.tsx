'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, MoreHorizontal, SendHorizontal } from 'lucide-react'
import { RoutePreviewMap } from '@/components/route/RoutePreviewMap'
import type { TripPlanView } from '@/lib/tripPlan/view'
import { DayCards } from './components/DayCards'
import { MarkdownBubble } from './components/MarkdownBubble'

type ChatEntry = { role: 'user' | 'assistant'; text: string }
type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'plan_updated' }
  | { type: 'done' }
  | { type: 'error'; message: string }

const NEAR_BOTTOM_THRESHOLD_PX = 80
const TEXTAREA_MAX_HEIGHT_PX = 128 // ≈ 4 行

export function PlanPlanner(props: { planId: string; initialPlan: TripPlanView; initialChat: ChatEntry[] }) {
  const [plan, setPlan] = useState(props.initialPlan)
  const [chat, setChat] = useState<ChatEntry[]>(props.initialChat)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedDay, setSelectedDay] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const mapPoints = useMemo(() => {
    const day = plan.days.find((d) => d.dayIndex === selectedDay) ?? plan.days[0]
    if (!day) return []
    return day.items
      .filter((item) => item.point && item.point.lat != null && item.point.lng != null)
      .map((item, idx) => ({
        lat: item.point!.lat as number,
        lng: item.point!.lng as number,
        label: `${idx + 1}. ${item.title}`,
      }))
  }, [plan, selectedDay])

  async function refreshPlan() {
    const res = await fetch(`/api/me/plans/${props.planId}`)
    if (!res.ok) return
    const body = (await res.json()) as { plan?: TripPlanView }
    if (body.plan) setPlan(body.plan)
  }

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX
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

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setInput('')
    setBusy(true)
    // 用户主动发送时强制跟随到底部（常规 chat 行为）
    nearBottomRef.current = true
    setChat((prev) => [...prev, { role: 'user', text: message }])

    try {
      const res = await fetch(`/api/me/plans/${props.planId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setChat((prev) => [...prev, { role: 'assistant', text: body?.error ?? '请求失败，请稍后再试' }])
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
          let event: AgentEvent
          try {
            event = JSON.parse(line.slice(5)) as AgentEvent
          } catch {
            continue
          }
          if (event.type === 'text') {
            setChat((prev) => [...prev, { role: 'assistant', text: event.text }])
          } else if (event.type === 'plan_updated') {
            await refreshPlan()
          } else if (event.type === 'error') {
            setChat((prev) => [...prev, { role: 'assistant', text: `出错了：${event.message}` }])
          }
        }
      }
    } finally {
      setBusy(false)
    }
  }

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
          {chat.map((entry, idx) =>
            entry.role === 'user' ? (
              <div
                key={idx}
                className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-brand-50 px-4 py-2 text-sm text-gray-900"
              >
                {entry.text}
              </div>
            ) : (
              <div key={idx} className="max-w-[92%] rounded-2xl bg-gray-50 px-4 py-2 text-sm text-gray-800">
                <MarkdownBubble text={entry.text} />
              </div>
            ),
          )}
          {busy ? <p className="text-xs text-gray-400">规划师思考中…</p> : null}

          {plan.days.length > 0 ? (
            <div className="space-y-4 pt-4">
              <DayCards plan={plan} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
              <RoutePreviewMap points={mapPoints} routeGeometry={null} className="h-64 w-full rounded-2xl" />
            </div>
          ) : null}
          <div ref={chatEndRef} />
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
