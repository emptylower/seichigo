import { normalizeDaySchedule, type ScheduleItemInput } from '../schedule'
import { derivePlaceMedia, sanitizeTransportPayload } from '../travelHelpers'
import type { Prisma } from '@prisma/client'
import type { TripPlanDayInput, TripPlanItemType } from '@/lib/tripPlan/repo'
import type { EnrichDay, EnricherName } from './types'

/**
 * schedule enricher：确定性时间归一化（自愈在 normalizer 内）。save 流程在
 * 原位置调用（enrichers 之后、gates 之前），把 ok/errors 喂给时间门；
 * ok 时同时完成 media 派生防线与 transport 载荷裁剪，输出可直接落库的天结构。
 */

export type ScheduleEnrichResult =
  | { ok: true; normalizedDays: TripPlanDayInput[] }
  | { ok: false; errors: Array<{ dayIndex: number; errors: string[] }> }

export function runScheduleEnricher(days: EnrichDay[]): ScheduleEnrichResult {
  const failures: Array<{ dayIndex: number; errors: string[] }> = []
  const normalizedDays: TripPlanDayInput[] = []
  for (const day of days) {
    const normalized = normalizeDaySchedule(day.items)
    if (!normalized.ok) {
      failures.push({ dayIndex: day.dayIndex, errors: normalized.errors })
      continue
    }
    normalizedDays.push({
      dayIndex: day.dayIndex,
      // S5：date 原样透传（save 路径的 EnrichDay 本就没有 date → null，
      // 与旧行为一致；续跑路径把落库的巡礼日期带回，写回不再被清空）
      date: day.date ?? null,
      citySlug: day.citySlug,
      summary: day.summary,
      items: normalized.items.map((item) => {
        const payload = { ...item.payload }
        derivePlaceMedia(payload, item.type)
        sanitizeTransportPayload(payload)
        return {
          type: item.type as TripPlanItemType,
          pointId: item.pointId ?? null,
          title: item.title,
          timeHint: item.timeHint,
          note: item.note,
          reason: item.reason,
          payload: payload as Prisma.JsonValue,
        }
      }),
    })
  }
  if (failures.length) return { ok: false, errors: failures }
  return { ok: true, normalizedDays }
}

/** 时间门用的整改文案（把归一化错误拼进 gates 的 fix） */
export function scheduleFailureSummary(result: Extract<ScheduleEnrichResult, { ok: false }>): string {
  return result.errors
    .map(({ dayIndex, errors }) => `Day ${dayIndex}：${errors.join('；')}`)
    .join('；')
}

/**
 * M4 修复：把每天条目排成归一化时间序（enrichers 在此之后运行——交通行要
 * 插在时间相邻的两个条目之间）。只借用 normalizeDaySchedule 的排序结果、
 * 不改写 payload：条目仍用原始引用（schedule 由 enrichers 之后的最终
 * normalizeDaySchedule 统一生成，避免把预排序推导的时刻固化成 explicit）。
 * 归一化失败的天保持原序（最终归一化会把错误交给时间门）。原地改写 days。
 *
 * N1 修复：预排序按"块"整体移动——非 transit 条目开块，紧随其后的 transit
 * 行钉在该块尾，只按非 transit 条目的解析开始时间排块。否则 [A(无时间),
 * transit A→B, B@09:00] 会被归一化顺延重排成 [A, B, T]（transit 行与其前
 * 置条目被拆散），enricher 看到 A/B 相邻无交通又在旁边插第二条交通行。
 */
export function orderDaysBySchedule(
  days: Array<{ items: Array<EnrichDay['items'][number]> }>,
): void {
  for (const day of days) {
    const originals = day.items
    if (!originals.length) continue
    const indexed: Array<ScheduleItemInput & { origIndex: number }> = originals.map((item, origIndex) => ({ ...item, origIndex }))
    const ordered = normalizeDaySchedule(indexed)
    if (!ordered.ok) continue
    const startByIndex = new Map<number, number>()
    for (const out of ordered.items) {
      const origIndex = (out as { origIndex?: number }).origIndex
      if (typeof origIndex === 'number') startByIndex.set(origIndex, out.resolvedStartMin)
    }
    type ScheduleBlock = { key: number; items: Array<EnrichDay['items'][number]> }
    const blocks: ScheduleBlock[] = []
    const leading: Array<EnrichDay['items'][number]> = []
    let current: ScheduleBlock | null = null
    originals.forEach((item, origIndex) => {
      if (item.type === 'transit') {
        // transit 行钉在其前置条目的块尾；首个非 transit 条目之前的原地留在最前
        if (current) current.items.push(item)
        else leading.push(item)
        return
      }
      current = { key: startByIndex.get(origIndex) ?? origIndex, items: [item] }
      blocks.push(current)
    })
    // 稳定排序：解析开始时间相同的块保持原始相对顺序
    blocks.sort((a, b) => a.key - b.key)
    day.items = [...leading, ...blocks.flatMap((block) => block.items)]
  }
}

export type { EnricherName }
