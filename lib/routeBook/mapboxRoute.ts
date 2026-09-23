// ---------------------------------------------------------------------------
// Mapbox Directions 纯客户端：给定有序停靠 + profile → 道路几何/距离/时长。
// 从 handlers/routeGeometry.ts 抽出（B1.1 A1），供 route-geometry 接口与
// 行程本整天几何（dayGeometry）共用。无缓存、无限流——调用方各自负责。
// ---------------------------------------------------------------------------

export type MapboxRouteProfile = 'walking' | 'driving' | 'cycling'

export type MapboxRouteGeometry = {
  type: 'LineString'
  coordinates: [number, number][]
}

export type MapboxRouteResult =
  | { ok: true; geometry: MapboxRouteGeometry; distance: number; duration: number }
  | { ok: false; reason: 'fetch' | 'http' | 'code' | 'no_route' }

type MapboxDirectionsBody = {
  code?: string
  routes?: Array<{
    geometry?: MapboxRouteGeometry
    distance?: number
    duration?: number
  }>
}

/** 与旧 routeGeometry handler 相同的环境变量顺序 */
export function readMapboxToken(): string | undefined {
  return process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_DIRECTIONS_TOKEN || undefined
}

const MAX_WAYPOINTS_PER_REQUEST = 25
const FETCH_TIMEOUT_MS = 10_000

function buildUrl(profile: MapboxRouteProfile, stops: { lat: number; lng: number }[], token: string): string {
  const coordinates = stops.map((p) => `${p.lng},${p.lat}`).join(';')
  return `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinates}?geometries=geojson&overview=full&access_token=${token}`
}

type SegmentResult =
  | { ok: true; geometry: MapboxRouteGeometry; distance: number; duration: number }
  | { ok: false; reason: 'fetch' | 'http' | 'code' | 'no_route' }

async function fetchSegment(
  profile: MapboxRouteProfile,
  stops: { lat: number; lng: number }[],
  deps: { token: string; fetch: typeof fetch },
): Promise<SegmentResult> {
  const apiUrl = buildUrl(profile, stops, deps.token)

  let mapboxRes: Response
  try {
    mapboxRes = await deps.fetch(apiUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch {
    return { ok: false, reason: 'fetch' }
  }

  if (!mapboxRes.ok) return { ok: false, reason: 'http' }

  const body = (await mapboxRes.json().catch(() => null)) as MapboxDirectionsBody | null
  if (!body || body.code !== 'Ok') return { ok: false, reason: 'code' }

  const route = body.routes?.[0]
  if (!route?.geometry) return { ok: false, reason: 'no_route' }

  return {
    ok: true,
    geometry: route.geometry,
    distance: route.distance ?? 0,
    duration: route.duration ?? 0,
  }
}

/**
 * 多于 25 站时按「共享边界站」分片请求再拼接（Mapbox 单请求最多 25 个路点；
 * 行程本一天最多 25 条 + 住宿首尾 = 27 站）。任一分片失败 → 整体失败。
 */
export async function fetchMapboxRoute(
  stops: { lat: number; lng: number }[],
  profile: MapboxRouteProfile,
  deps: { token: string; fetch?: typeof fetch },
): Promise<MapboxRouteResult> {
  if (stops.length < 2) return { ok: false, reason: 'no_route' }
  const fetchImpl = deps.fetch ?? fetch

  const segments: Array<{ lat: number; lng: number }[]> = []
  for (let start = 0; start < stops.length; start += MAX_WAYPOINTS_PER_REQUEST - 1) {
    segments.push(stops.slice(start, start + MAX_WAYPOINTS_PER_REQUEST))
  }

  let coordinates: [number, number][] = []
  let distance = 0
  let duration = 0

  let isFirstSegment = true
  for (const segment of segments) {
    const result = await fetchSegment(profile, segment, { token: deps.token, fetch: fetchImpl })
    if (!result.ok) return result
    // 分片间共享边界站：后续分片去掉首个坐标避免重复
    coordinates = coordinates.concat(isFirstSegment ? result.geometry.coordinates : result.geometry.coordinates.slice(1))
    distance += result.distance
    duration += result.duration
    isFirstSegment = false
  }

  return { ok: true, geometry: { type: 'LineString', coordinates }, distance, duration }
}
