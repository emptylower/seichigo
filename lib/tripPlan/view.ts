import type { Prisma } from '@prisma/client'
import { inferLegacyAskTaskType, isAskUserTaskType, type AskUserPayload } from '@/lib/planAgent/askUser'
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
 * daymap 是 save_plan_days 成功后追加的行程交付快照（TripPlanMessage
 * kind='daymap' 的 content）。days 必须是替换成功那一刻的结构化快照
 * （含点位、外部地点 payload、schedule、transport、media 与 provider
 * 折线）——不能只存 plan id 回读当前 days，否则旧地图会被后续保存改写。
 * 载荷不可变且不含任何 API key。
 */
export type DaymapMessagePayload = {
  type: 'daymap'
  revisionId: string
  savedAt: string
  days: TripPlanDayView[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * daymap 载荷的统一解析器：SSE daymap 事件与落库 kind=daymap 消息共用，
 * 保证实时渲染与刷新后的字段口径一致。畸形载荷返回 null（防御性丢弃，
 * 不阻塞聊天流渲染）。
 */
export function parseDaymapPayload(raw: unknown): DaymapMessagePayload | null {
  if (!isPlainObject(raw) || raw.type !== 'daymap') return null
  const revisionId = typeof raw.revisionId === 'string' ? raw.revisionId.trim() : ''
  const savedAt = typeof raw.savedAt === 'string' ? raw.savedAt.trim() : ''
  if (!revisionId || !savedAt) return null
  if (!Array.isArray(raw.days)) return null
  const days: TripPlanDayView[] = []
  for (const day of raw.days) {
    if (!isPlainObject(day) || !Array.isArray(day.items)) continue
    days.push({
      id: typeof day.id === 'string' && day.id ? day.id : `day-${days.length + 1}`,
      dayIndex: Number.isFinite(Number(day.dayIndex)) ? Number(day.dayIndex) : days.length + 1,
      date: typeof day.date === 'string' ? day.date : null,
      citySlug: typeof day.citySlug === 'string' ? day.citySlug : null,
      summary: typeof day.summary === 'string' ? day.summary : null,
      items: day.items.filter((item): item is TripPlanItemView => isPlainObject(item)),
    })
  }
  return { type: 'daymap', revisionId, savedAt, days }
}

/**
 * ask 是 ask_user 落库的结构化提问：降级映射为 assistant 气泡（prompt 作
 * 文本，旧前端不渲染组件时也能看到问题本身），完整 payload 挂在 ask 字段
 * 上供前端重建交互组件。不能引入新的 role 变体——page.tsx 会把本视图直接
 * 传给按 user/assistant 二分渲染的客户端组件。
 * daymap 是行程交付快照：作为独立的 assistant 时间线条目携带 daymap 载荷
 * （text 为空串，渲染层只认 daymap 字段）。
 */
export type ChatEntryView = {
  role: 'user' | 'assistant'
  text: string
  ask?: AskUserPayload
  daymap?: DaymapMessagePayload
}

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
        // 历史兼容归一化只在此处做一次：无 taskType 的旧 ask 按规则推断，
        // 前端（实时 SSE 与刷新两条路径）拿到的载荷恒带 taskType
        const taskType = isAskUserTaskType(payload.taskType) ? payload.taskType : inferLegacyAskTaskType(payload)
        entries.push({ role: 'assistant', text: payload.prompt, ask: { ...payload, taskType } })
      }
    } else if (message.kind === 'daymap') {
      const daymap = parseDaymapPayload(message.content)
      if (daymap) entries.push({ role: 'assistant', text: '', daymap })
    }
  }
  return entries
}
