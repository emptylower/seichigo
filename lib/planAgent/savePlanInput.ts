import { TRIP_PLAN_ITEM_TYPES, type TripPlanItemType } from '@/lib/tripPlan/repo'
import type { ScheduleItemInput } from './schedule'

/**
 * save_plan_days 入参的结构化解析（N4 从 tools.ts 拆出：行数预算）。
 * 纯归一化、无副作用：未知 type 落为 'free'，缺省字段补 null，标题去空白、
 * 空标题兜底「未命名条目」。天数上限 30 与条目总数上限 150 的校验留在
 * tools.ts（需要返回结构化错误）。
 */

export type ParsedSaveDays = Array<{
  dayIndex: number
  citySlug: string | null
  summary: string | null
  items: ScheduleItemInput[]
}>

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

export function parseSavePlanDaysInput(rawDays: unknown[]): ParsedSaveDays {
  return rawDays.map((raw) => {
    const day = asRecord(raw)
    const items = Array.isArray(day.items) ? day.items : []
    return {
      dayIndex: Math.max(1, Math.floor(Number(day.dayIndex) || 1)),
      citySlug: typeof day.citySlug === 'string' ? day.citySlug : null,
      summary: typeof day.summary === 'string' ? day.summary : null,
      items: items.map((rawItem) => {
        const item = asRecord(rawItem)
        const type = TRIP_PLAN_ITEM_TYPES.includes(item.type as TripPlanItemType)
          ? (item.type as TripPlanItemType)
          : 'free'
        return {
          type,
          pointId: typeof item.pointId === 'string' ? item.pointId : null,
          title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '未命名条目',
          timeHint: typeof item.timeHint === 'string' ? item.timeHint : null,
          note: typeof item.note === 'string' ? item.note : null,
          reason: typeof item.reason === 'string' ? item.reason : null,
          payload:
            typeof item.payload === 'object' && item.payload !== null && !Array.isArray(item.payload)
              ? (item.payload as Record<string, unknown>)
              : null,
        }
      }),
    }
  })
}
