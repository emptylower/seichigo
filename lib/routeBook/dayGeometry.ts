import type { Prisma } from '@prisma/client'
import { getCachedRoutePayload, routeLegCacheKey, setCachedRoutePayload } from './legCache'
import { fetchMapboxRoute, readMapboxToken, type MapboxRouteGeometry } from './mapboxRoute'
import type { TravelMode } from './repo'

// ---------------------------------------------------------------------------
// 整天真实道路几何（B1.1 A1）：用当天的停靠序列（含住宿首尾）一次串成道路
// 路线。任何失败（无 token / 少于 2 站 / Mapbox 错误）都返回 null，绝不影响
// legs 的计算。缓存走 RouteLegCache 表，TTL 7 天。
// ---------------------------------------------------------------------------

/** Mapbox 无公交：transit 按 walking 请求（旧路线本页面同策略） */
const DAY_PROFILE: Record<TravelMode, 'walking' | 'driving'> = {
  walking: 'walking',
  driving: 'driving',
  transit: 'walking',
}

function isLineString(value: unknown): value is MapboxRouteGeometry {
  if (typeof value !== 'object' || value === null) return false
  const shape = value as { type?: unknown; coordinates?: unknown }
  return shape.type === 'LineString' && Array.isArray(shape.coordinates)
}

function dayRouteCacheKey(profile: 'walking' | 'driving', stops: { lat: number; lng: number }[]): string {
  const coords = stops.map((stop) => `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`).join(';')
  return routeLegCacheKey(`dayroute|${profile}|${coords}`)
}

/** A2：客户端顺序签名的辅助缓存 key（sig 不透明，客户端保证签名随数据变化） */
export function dayRouteSigCacheKey(dayId: string, sig: string): string {
  return routeLegCacheKey(`dayroute-sig|${dayId}|${sig}`)
}

/** A2：按 sig 直读整天几何（handler 与库查询并行发起，命中则跳过 Mapbox 路径） */
export async function readDayGeometryBySig(
  dayId: string,
  sig: string
): Promise<MapboxRouteGeometry | null> {
  const cached = await getCachedRoutePayload(dayRouteSigCacheKey(dayId, sig))
  return isLineString(cached) ? cached : null
}

export async function resolveDayGeometry(
  stops: { lat: number; lng: number }[],
  mode: TravelMode,
  sigCache?: { dayId: string; sig: string }
): Promise<MapboxRouteGeometry | null> {
  if (stops.length < 2) return null
  const token = readMapboxToken()
  if (!token) return null

  const profile = DAY_PROFILE[mode]
  const key = dayRouteCacheKey(profile, stops)

  const cached = await getCachedRoutePayload(key)
  if (isLineString(cached)) {
    // A2：坐标 key 命中时顺手回填 sig key（不阻塞），让下次带 sig 的请求能一步命中
    if (sigCache) {
      void setCachedRoutePayload(dayRouteSigCacheKey(sigCache.dayId, sigCache.sig), cached as Prisma.InputJsonValue).catch(
        () => {}
      )
    }
    return cached
  }

  const result = await fetchMapboxRoute(stops, profile, { token })
  if (!result.ok) return null

  // A1：缓存写入不阻塞响应，失败静默（下次未命中重写）；A2：Mapbox 结果同时写坐标 key 与 sig key
  void setCachedRoutePayload(key, result.geometry as Prisma.InputJsonValue).catch(() => {})
  if (sigCache) {
    void setCachedRoutePayload(
      dayRouteSigCacheKey(sigCache.dayId, sigCache.sig),
      result.geometry as Prisma.InputJsonValue
    ).catch(() => {})
  }
  return result.geometry
}
