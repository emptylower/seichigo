import type { Prisma } from '@prisma/client'
import {
  decodePolyline,
  fetchGoogleDirections,
  isWithinJapan,
  parseRouteLegs,
  readOverviewPolyline,
} from '@/lib/directions/googleClient'
import { getCachedRoutePayload, routeLegCacheKey, setCachedLeg } from './legCache'
import type { LegResolver } from './legs'
import type { LatLng } from './optimize'
import type { TravelMode } from './repo'

// ---------------------------------------------------------------------------
// Google Directions 段解析器（B2 A2）。只处理 walking / driving——日本境内
// Google 无公交数据（ZERO_RESULTS），transit 一律返回 null 走 heuristic
// （lib/directions/googleClient.ts:143-149）。两端都在日本列岛 bbox 内才调
// 上游；成功结果写 RouteLegCache（key `leg|<mode>|lat5,lng5|lat5,lng5`
// 经 sha256，TTL 7 天）。任何失败返回 null，由调用方降级。
// ---------------------------------------------------------------------------

/** 单段上游超时；handler 侧另有整天 8 秒整体截止兜底 */
const LEG_RESOLVER_TIMEOUT_MS = 6_000

/** 段级缓存 raw key（再经 routeLegCacheKey sha256 入库） */
export function googleLegCacheRawKey(mode: TravelMode, from: LatLng, to: LatLng): string {
  return `leg|${mode}|${from.lat.toFixed(5)},${from.lng.toFixed(5)}|${to.lat.toFixed(5)},${to.lng.toFixed(5)}`
}

export type GoogleLegPayload = {
  durationSec: number
  distanceM: number
  polyline: [number, number][] | null
  source: 'google'
}

/** 缓存 payload 的形状校验（脏数据按未命中处理） */
export function readCachedGoogleLegPayload(value: unknown): GoogleLegPayload | null {
  if (typeof value !== 'object' || value === null) return null
  const shape = value as { durationSec?: unknown; distanceM?: unknown; polyline?: unknown; source?: unknown }
  if (shape.source !== 'google') return null
  if (typeof shape.durationSec !== 'number' || !Number.isFinite(shape.durationSec) || shape.durationSec <= 0) return null
  if (typeof shape.distanceM !== 'number' || !Number.isFinite(shape.distanceM) || shape.distanceM < 0) return null
  if (shape.polyline !== null) {
    if (!Array.isArray(shape.polyline)) return null
    for (const point of shape.polyline) {
      if (!Array.isArray(point) || point.length < 2) return null
      if (typeof point[0] !== 'number' || typeof point[1] !== 'number') return null
    }
  }
  return {
    durationSec: shape.durationSec,
    distanceM: shape.distanceM,
    polyline: shape.polyline as [number, number][] | null,
    source: 'google',
  }
}

export function createGoogleLegResolver(opts?: { apiKey?: string; fetchImpl?: typeof fetch }): LegResolver {
  const apiKey = opts?.apiKey ?? (process.env.GOOGLE_DIRECTIONS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '')
  const fetchImpl = opts?.fetchImpl

  return async (from, to, mode) => {
    if (mode !== 'walking' && mode !== 'driving') return null
    if (!isWithinJapan(from.lat, from.lng) || !isWithinJapan(to.lat, to.lng)) return null

    const key = routeLegCacheKey(googleLegCacheRawKey(mode, from, to))
    const cached = await getCachedRoutePayload(key)
    const cachedRead = cached === null ? null : readCachedGoogleLegPayload(cached)
    if (cachedRead) return cachedRead
    if (!apiKey) return null

    let result: Awaited<ReturnType<typeof fetchGoogleDirections>>
    try {
      result = await fetchGoogleDirections({
        origin: `${from.lat},${from.lng}`,
        destination: `${to.lat},${to.lng}`,
        mode,
        apiKey,
        timeoutMs: LEG_RESOLVER_TIMEOUT_MS,
        ...(fetchImpl ? { fetchImpl } : {}),
      })
    } catch {
      return null
    }
    if (!result.ok || result.body?.status !== 'OK') return null

    const legs = parseRouteLegs(result.body)
    if (!legs.length) return null

    const encoded = readOverviewPolyline(result.body)
    const polyline = encoded ? decodePolyline(encoded) : []
    const payload: GoogleLegPayload = {
      durationSec: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0),
      distanceM: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
      polyline: polyline.length ? polyline : null,
      source: 'google',
    }
    await setCachedLeg(key, payload as Prisma.InputJsonValue)
    return payload
  }
}
