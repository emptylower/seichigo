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

export async function resolveDayGeometry(
  stops: { lat: number; lng: number }[],
  mode: TravelMode
): Promise<MapboxRouteGeometry | null> {
  if (stops.length < 2) return null
  const token = readMapboxToken()
  if (!token) return null

  const profile = DAY_PROFILE[mode]
  const key = dayRouteCacheKey(profile, stops)

  const cached = await getCachedRoutePayload(key)
  if (isLineString(cached)) return cached

  const result = await fetchMapboxRoute(stops, profile, { token })
  if (!result.ok) return null

  await setCachedRoutePayload(key, result.geometry as Prisma.InputJsonValue)
  return result.geometry
}
