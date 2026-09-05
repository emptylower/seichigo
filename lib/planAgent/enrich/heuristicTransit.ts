import { haversineKm } from '../cluster'
import { buildTransitMapsUrl } from '../travelQuery'

/**
 * 零外呼交通估算（回归第三轮 A5）：Directions 预算耗尽、查询失败或服务
 * 未配置时，用直线距离（haversine）推算参考交通载荷，绝不让 transit 缺口
 * 留空。公式与 estimate_transit 工具同源（≤1.5km 步行，否则按 25km/h 均速
 * +12 分钟换乘余量）；估算行带 source:'heuristic' 标记——下一次保存有预算时
 * 会被 transport enricher 的真实查询替换（视为"待升级"，不算已合格交通）。
 */

export const HEURISTIC_WALK_THRESHOLD_KM = 1.5

export const HEURISTIC_TRANSIT_NOTE =
  '外部交通查询暂不可用或预算已用完，此为按直线距离推算的参考估算值；下次保存时会自动升级为真实路线'

export type HeuristicTransitCore = {
  mode: 'walk' | 'transit'
  durationMin: number
  distanceKm: number
  mapsUrl: string
}

/** 直线距离推算的核心数值（estimate_transit 工具与 transport enricher 共用） */
export function computeHeuristicTransitCore(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): HeuristicTransitCore {
  const km = haversineKm(from, to)
  const mode: 'walk' | 'transit' = km <= HEURISTIC_WALK_THRESHOLD_KM ? 'walk' : 'transit'
  const durationMin =
    mode === 'walk' ? Math.max(3, Math.round((km / 4.5) * 60)) : Math.max(10, Math.round((km / 25) * 60) + 12)
  return {
    mode,
    durationMin,
    distanceKm: Math.round(km * 10) / 10,
    mapsUrl: buildTransitMapsUrl(from, to),
  }
}

/** transport enricher 的估算载荷：provider estimate + source heuristic（待升级标记） */
export function buildHeuristicTransitPayload(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Record<string, unknown> {
  return {
    ...computeHeuristicTransitCore(from, to),
    transfers: null,
    provider: 'estimate',
    estimated: true,
    source: 'heuristic',
    note: HEURISTIC_TRANSIT_NOTE,
    fetchedAt: new Date().toISOString(),
    legs: [],
  }
}
