/**
 * R2：把「部分段有真实 provider polyline」的一天拼成**一条连续**路线。
 *
 * 第九轮后交通段只有部分升级为真实 Google 路线，旧口径（collectProviderGeometry）
 * 只把这些零散折线首尾串起来，于是地图上只剩几段线、其余点位之间完全没有连线。
 * 这里按点位顺序逐段处理：该段有可信 polyline 就用它，否则用两端点直线，
 * 段与段首尾相接（并去掉相邻重复坐标），保证每个点位都落在线上。
 */
import type { TripPlanItemView } from '@/lib/tripPlan/view'
import { distanceMeters } from '@/components/route/routePreviewMarkers'
import {
  ensureDayScheduleForRender,
  getTransport,
  isRoutablePointItem,
  itemLatLng,
  sortItemsBySchedule,
} from './itemPayload'

/** provider：每段都是真实路线；mixed：部分段是直线示意；none：一段都没有 */
export type DayRouteCoverage = 'provider' | 'mixed' | 'none'

export type DayRouteComposition = {
  coordinates: Array<[number, number]>
  coverage: DayRouteCoverage
}

/** polyline 首尾允许离端点的最大距离：超出说明这段折线不是这两个点之间的路线 */
const ENDPOINT_TOLERANCE_METERS = 300

/** 该段可用的 provider 折线（[lat,lng] → [lng,lat]）；不可信时返回 null */
function segmentPolyline(
  items: TripPlanItemView[],
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Array<[number, number]> | null {
  for (const item of items) {
    const polyline = getTransport(item)?.polyline
    if (!polyline || polyline.length < 2) continue
    const coordinates = polyline.map(([lat, lng]) => [lng, lat] as [number, number])
    const head = coordinates[0]!
    const tail = coordinates[coordinates.length - 1]!
    if (distanceMeters(head, [from.lng, from.lat]) > ENDPOINT_TOLERANCE_METERS) continue
    if (distanceMeters(tail, [to.lng, to.lat]) > ENDPOINT_TOLERANCE_METERS) continue
    return coordinates
  }
  return null
}

export function composeDayRoute(
  dayPoints: Array<{ lat: number; lng: number }>,
  items: TripPlanItemView[],
): DayRouteComposition {
  if (dayPoints.length < 2) return { coordinates: [], coverage: 'none' }

  // 与 dayRoutePoints 同一份排序：第 i 个可路由条目 ↔ 第 i 个 dayPoint
  const sorted = sortItemsBySchedule(ensureDayScheduleForRender(items))
  const routableIndexes: number[] = []
  sorted.forEach((item, index) => {
    if (isRoutablePointItem(item) && itemLatLng(item)) routableIndexes.push(index)
  })
  // 条目与点位对不上（调用方传了别的列表）：只画直线，不猜 polyline 归属
  const aligned = routableIndexes.length === dayPoints.length

  const coordinates: Array<[number, number]> = []
  const push = (coordinate: [number, number]) => {
    const last = coordinates[coordinates.length - 1]
    if (last && last[0] === coordinate[0] && last[1] === coordinate[1]) return
    coordinates.push(coordinate)
  }

  let providerSegments = 0
  for (let index = 0; index < dayPoints.length - 1; index += 1) {
    const from = dayPoints[index]!
    const to = dayPoints[index + 1]!
    const between = aligned ? sorted.slice(routableIndexes[index]! + 1, routableIndexes[index + 1]!) : []
    const polyline = segmentPolyline(between, from, to)
    push([from.lng, from.lat])
    if (polyline) {
      providerSegments += 1
      for (const coordinate of polyline) push(coordinate)
    }
    push([to.lng, to.lat])
  }

  const segments = dayPoints.length - 1
  const coverage: DayRouteCoverage =
    providerSegments === 0 ? 'none' : providerSegments === segments ? 'provider' : 'mixed'
  return { coordinates, coverage }
}
