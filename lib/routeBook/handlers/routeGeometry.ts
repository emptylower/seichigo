import { NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GeoJSONLineString = {
  type: 'LineString'
  coordinates: [number, number][]
}

export type RouteGeometryResponse =
  | { ok: true; geometry: GeoJSONLineString; distance: number; duration: number; mode: string }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// In-memory cache (key -> { data, expiresAt })
// ---------------------------------------------------------------------------

type CacheEntry = { data: RouteGeometryResponse & { ok: true }; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function getCached(key: string): (RouteGeometryResponse & { ok: true }) | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key: string, data: RouteGeometryResponse & { ok: true }) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ---------------------------------------------------------------------------
// Rate limiter (per-user, 10 req/min)
// ---------------------------------------------------------------------------

type RateEntry = { count: number; windowStart: number }
const rateLimits = new Map<string, RateEntry>()
const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX = 10

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const entry = rateLimits.get(userId)
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimits.set(userId, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_MAX) return false
  entry.count++
  return true
}

// ---------------------------------------------------------------------------
// Coordinate parsing & validation
// ---------------------------------------------------------------------------

function parsePoints(raw: string): { lng: number; lat: number }[] | null {
  const pairs = raw.split('|')
  const points: { lng: number; lat: number }[] = []

  for (const pair of pairs) {
    const [lngStr, latStr] = pair.split(',')
    const lng = Number(lngStr)
    const lat = Number(latStr)

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null

    points.push({ lng, lat })
  }

  return points
}

// ---------------------------------------------------------------------------
// Mapbox Directions API types
// ---------------------------------------------------------------------------

type MapboxDirectionsBody = {
  code?: string
  routes?: Array<{
    geometry?: GeoJSONLineString
    distance?: number
    duration?: number
  }>
}

const MAPBOX_PROFILES: Record<string, string> = {
  walking: 'walking',
  driving: 'driving',
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createRouteGeometryHandler() {
  return {
    async GET(req: Request, userId: string) {
      // Rate limit
      if (!checkRateLimit(userId)) {
        return NextResponse.json(
          { ok: false, error: '请求过于频繁，请稍后再试' },
          { status: 429 },
        )
      }

      // Parse query params
      const url = new URL(req.url)
      const pointsRaw = url.searchParams.get('points')
      const mode = url.searchParams.get('mode') || 'walking'

      if (!pointsRaw) {
        return NextResponse.json(
          { ok: false, error: '缺少 points 参数' },
          { status: 400 },
        )
      }

      if (mode !== 'walking' && mode !== 'driving') {
        return NextResponse.json(
          { ok: false, error: 'mode 必须为 walking 或 driving' },
          { status: 400 },
        )
      }

      const points = parsePoints(pointsRaw)
      if (!points) {
        return NextResponse.json(
          { ok: false, error: '坐标格式错误，应为 lng,lat|lng,lat' },
          { status: 400 },
        )
      }

      if (points.length < 2) {
        return NextResponse.json(
          { ok: false, error: '至少需要 2 个坐标点' },
          { status: 400 },
        )
      }

      if (points.length > 25) {
        return NextResponse.json(
          { ok: false, error: '坐标点不能超过 25 个' },
          { status: 400 },
        )
      }

      // Cache check
      const key = `${pointsRaw}|${mode}`
      const cached = getCached(key)
      if (cached) {
        return NextResponse.json(cached)
      }

      // Check Mapbox token
      const token =
        process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
        process.env.MAPBOX_DIRECTIONS_TOKEN
      if (!token) {
        return NextResponse.json(
          { ok: false, error: '路线预览服务未配置' },
          { status: 503 },
        )
      }

      // Build Mapbox Directions API URL
      const profile = MAPBOX_PROFILES[mode]
      const coordinates = points.map((p) => `${p.lng},${p.lat}`).join(';')
      const apiUrl = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinates}?geometries=geojson&overview=full&access_token=${token}`

      // Fetch from Mapbox
      let mapboxRes: Response
      try {
        mapboxRes = await fetch(apiUrl, { signal: AbortSignal.timeout(10_000) })
      } catch {
        console.error('[routeGeometry] Mapbox API fetch failed')
        return NextResponse.json(
          { ok: false, error: '路线服务请求超时' },
          { status: 502 },
        )
      }

      if (!mapboxRes.ok) {
        console.error('[routeGeometry] Mapbox API HTTP error', mapboxRes.status)
        return NextResponse.json(
          { ok: false, error: '路线获取失败' },
          { status: 502 },
        )
      }

      const body = (await mapboxRes.json().catch(() => null)) as MapboxDirectionsBody | null

      if (!body || body.code !== 'Ok') {
        console.error('[routeGeometry] Mapbox API code', body?.code)
        return NextResponse.json(
          { ok: false, error: '路线获取失败' },
          { status: 502 },
        )
      }

      const route = body.routes?.[0]
      if (!route?.geometry) {
        return NextResponse.json(
          { ok: false, error: '未找到路线' },
          { status: 400 },
        )
      }

      const result: RouteGeometryResponse & { ok: true } = {
        ok: true,
        geometry: route.geometry,
        distance: route.distance ?? 0,
        duration: route.duration ?? 0,
        mode,
      }

      // Cache result
      setCache(key, result)

      return NextResponse.json(result)
    },
  }
}
