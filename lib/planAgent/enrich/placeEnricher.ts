import { backfillExternalPlaces } from '../placeBackstop'
import type { EnrichContext, EnrichDay, EnrichReport } from './types'

/**
 * place enricher：包装既有 backfillExternalPlaces（库优先、Google 兜底、质心
 * 偏置 + 距离守卫），把它的 Google 调用接到共享预算上。解析成功的条目原地
 * 写入 payload.place；失败保持原样（skipped 由底层记录）。
 */
export async function runPlaceEnricher(days: EnrichDay[], ctx: EnrichContext, report: EnrichReport): Promise<void> {
  const result = await backfillExternalPlaces({
    days,
    places: ctx.deps.places,
    dayCoordinates: ctx.dayCoordinates ?? (() => []),
    ...(ctx.budget ? { budget: ctx.budget } : {}),
  })
  report.applied.place += result.resolved
  for (const skip of result.skipped) {
    report.skipped.push({ enricher: 'place', itemTitle: skip.title, reason: skip.reason })
  }
}
