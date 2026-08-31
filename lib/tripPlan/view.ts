import type { Prisma } from '@prisma/client'
import type { AskUserPayload } from '@/lib/planAgent/askUser'
import type { TripPlan, TripPlanItemType, TripPlanMessage, TripPlanStatus, TripPlanWithDays } from './repo'

export type TripPlanItemView = {
  id: string
  sortOrder: number
  type: TripPlanItemType
  pointId: string | null
  timeHint: string | null
  title: string
  note: string | null
  reason: string | null
  payload: Prisma.JsonValue | null
  point: { id: string; name: string; nameZh: string | null; lat: number | null; lng: number | null; image: string | null } | null
}

export type TripPlanDayView = {
  id: string
  dayIndex: number
  date: string | null
  citySlug: string | null
  summary: string | null
  items: TripPlanItemView[]
}

export type TripPlanView = {
  id: string
  title: string
  status: TripPlanStatus
  startDate: string | null
  dayCount: number
  bangumiIds: number[]
  updatedAt: string
  days: TripPlanDayView[]
}

export type TripPlanListItemView = Omit<TripPlanView, 'days'>

export function toPlanListItemView(plan: TripPlan): TripPlanListItemView {
  return {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    startDate: plan.startDate ? plan.startDate.toISOString() : null,
    dayCount: plan.dayCount,
    bangumiIds: plan.bangumiIds,
    updatedAt: plan.updatedAt.toISOString(),
  }
}

export function toPlanView(plan: TripPlanWithDays): TripPlanView {
  return {
    ...toPlanListItemView(plan),
    days: plan.days.map((day) => ({
      id: day.id,
      dayIndex: day.dayIndex,
      date: day.date ? day.date.toISOString() : null,
      citySlug: day.citySlug,
      summary: day.summary,
      items: day.items.map((item) => ({
        id: item.id,
        sortOrder: item.sortOrder,
        type: item.type,
        pointId: item.pointId,
        timeHint: item.timeHint,
        title: item.title,
        note: item.note,
        reason: item.reason,
        payload: item.payload,
        point: item.point,
      })),
    })),
  }
}

/**
 * ask 是 ask_user 落库的结构化提问：降级映射为 assistant 气泡（prompt 作
 * 文本，旧前端不渲染组件时也能看到问题本身），完整 payload 挂在 ask 字段
 * 上供前端重建交互组件。不能引入新的 role 变体——page.tsx 会把本视图直接
 * 传给按 user/assistant 二分渲染的客户端组件。
 */
export type ChatEntryView = { role: 'user' | 'assistant'; text: string; ask?: AskUserPayload }

export function toChatView(messages: TripPlanMessage[]): ChatEntryView[] {
  const entries: ChatEntryView[] = []
  for (const message of messages) {
    const content = message.content as { role?: string; content?: unknown } | null
    if (message.kind === 'human' && typeof content?.content === 'string') {
      entries.push({ role: 'user', text: content.content })
    } else if (message.kind === 'assistant' && typeof content?.content === 'string' && content.content) {
      entries.push({ role: 'assistant', text: content.content })
    } else if (message.kind === 'ask') {
      const payload = message.content as unknown as AskUserPayload | null
      if (payload && typeof payload === 'object' && typeof payload.askId === 'string' && typeof payload.prompt === 'string') {
        entries.push({ role: 'assistant', text: payload.prompt, ask: payload })
      }
    }
  }
  return entries
}
