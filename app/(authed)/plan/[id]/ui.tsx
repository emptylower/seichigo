'use client'

import { useMemo, useRef, useState } from 'react'
import { RoutePreviewMap } from '@/components/route/RoutePreviewMap'
import type { TripPlanView } from '@/lib/tripPlan/view'
import { DayCards } from './components/DayCards'

type ChatEntry = { role: 'user' | 'assistant'; text: string }
type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'plan_updated' }
  | { type: 'done' }
  | { type: 'error'; message: string }

export function PlanPlanner(props: { planId: string; initialPlan: TripPlanView; initialChat: ChatEntry[] }) {
  const [plan, setPlan] = useState(props.initialPlan)
  const [chat, setChat] = useState<ChatEntry[]>(props.initialChat)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedDay, setSelectedDay] = useState(1)
  const chatEndRef = useRef<HTMLDivElement>(null)

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

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setInput('')
    setBusy(true)
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
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(320px,2fr)_3fr]">
      <section className="flex h-[70vh] flex-col rounded-2xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">{plan.title}</div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {chat.length === 0 ? (
            <p className="text-sm text-gray-400">
              试试：“帮我安排下个月中旬去京都，做京吹圣地巡礼的 3 天计划”
            </p>
          ) : null}
          {chat.map((entry, idx) => (
            <div
              key={idx}
              className={
                entry.role === 'user'
                  ? 'ml-auto max-w-[85%] rounded-2xl bg-brand-50 px-4 py-2 text-sm text-gray-900'
                  : 'max-w-[92%] whitespace-pre-wrap rounded-2xl bg-gray-50 px-4 py-2 text-sm text-gray-800'
              }
            >
              {entry.text}
            </div>
          ))}
          {busy ? <p className="text-xs text-gray-400">规划师思考中…</p> : null}
          <div ref={chatEndRef} />
        </div>
        <form
          className="flex gap-2 border-t border-gray-100 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="告诉规划师你的巡礼想法…"
            className="flex-1 rounded-full border border-gray-200 px-4 py-2 text-sm outline-none focus:border-brand-400"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            发送
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <RoutePreviewMap points={mapPoints} routeGeometry={null} className="h-64 w-full rounded-2xl" />
        <DayCards plan={plan} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
      </section>
    </div>
  )
}
