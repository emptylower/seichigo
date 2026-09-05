import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import {
  fetchGoogleDirections,
  parseRouteLegs,
  type DirectionLeg,
  type GoogleDirectionsBody,
} from '@/lib/directions/googleClient'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { DirectionLeg, DirectionStep, TransitDetail } from '@/lib/directions/googleClient'

export type DirectionsResult = {
  ok: true
  legs: DirectionLeg[]
  mode: 'transit' | 'driving' | 'walking'
  requestedMode: 'transit' | 'driving' | 'walking'
  fallbackApplied: boolean
}

type GoogleApiStatus = string

// ---------------------------------------------------------------------------
// In-memory cache (key -> { data, expiresAt })
// ---------------------------------------------------------------------------

type CacheEntry = { data: DirectionsResult; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function cacheKey(origin: string, destination: string, waypoints: string, mode: string, departureTime: string) {
  return `${origin}|${destination}|${waypoints}|${mode}|${departureTime}`
}

function getCached(key: string): DirectionsResult | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key: string, data: DirectionsResult) {
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

const TRAVEL_MODES = ['transit', 'driving', 'walking'] as const
type TravelModeParam = (typeof TRAVEL_MODES)[number]

function parseTravelMode(raw: string | null): TravelModeParam | null {
  const value = String(raw || '').trim().toLowerCase()
  return (TRAVEL_MODES as readonly string[]).includes(value) ? (value as TravelModeParam) : null
}

/** departure_time 参数：epoch 秒或 ISO 字符串（agent/精确日期场景） */
function parseDepartureTime(raw: string | null): number | null {
  const value = String(raw || '').trim()
  if (!value) return null
  const asNumber = Number(value)
  if (Number.isFinite(asNumber) && asNumber > 0) return Math.floor(asNumber)
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return Math.floor(parsed.getTime() / 1000)
  return null
}

// ---------------------------------------------------------------------------
// Deps type
// ---------------------------------------------------------------------------

export type DirectionsHandlerDeps = {
  getSession: () => Promise<Session | null>
  apiKey: string
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createHandlers(deps: DirectionsHandlerDeps) {
  return {
    async GET(req: Request) {
      // Auth check
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '未登录' }, { status: 401 })
      }

      // Parse query params
      const url = new URL(req.url)
      const origin = url.searchParams.get('origin')
      const destination = url.searchParams.get('destination')
      const waypoints = url.searchParams.get('waypoints') || ''
      const rawMode = url.searchParams.get('mode')
      // 缺省 transit（历史行为）；显式传了不合法的值要 400，而不是静默换模式
      const requestedMode = rawMode == null ? 'transit' : parseTravelMode(rawMode)
      if (!requestedMode) {
        return NextResponse.json(
          { error: 'mode 必须为 transit、driving 或 walking' },
          { status: 400 },
        )
      }
      const departureTimeSec = parseDepartureTime(url.searchParams.get('departure_time'))
      // 公交 ZERO_RESULTS 时的步行回退默认开启（路书"公交+步行"页签的行为）；
      // 需要区分 ZERO_RESULTS 的调用方（plan agent）传 allowWalkFallback=0 关闭。
      const allowWalkFallback = url.searchParams.get('allowWalkFallback') !== '0'
      const primaryWaypoints = requestedMode === 'transit' ? '' : waypoints

      if (!origin || !destination) {
        return NextResponse.json(
          { error: '缺少 origin 或 destination 参数' },
          { status: 400 },
        )
      }

      // Rate limit
      if (!checkRateLimit(session.user.id)) {
        return NextResponse.json(
          { error: '请求过于频繁，请稍后再试' },
          { status: 429 },
        )
      }

      // Cache check
      const key = cacheKey(origin, destination, waypoints, requestedMode, departureTimeSec ? String(departureTimeSec) : '')
      const cached = getCached(key)
      if (cached) {
        return NextResponse.json(cached)
      }

      const primary = await fetchGoogleDirections({
        origin,
        destination,
        mode: requestedMode,
        waypoints: primaryWaypoints,
        departureTimeSec: departureTimeSec ?? undefined,
        apiKey: deps.apiKey,
      })

      if (!primary.ok) {
        console.error('[directions] Google API HTTP error', primary.httpStatus)
        return NextResponse.json(
          { error: 'Google Directions API 请求失败' },
          { status: 502 },
        )
      }

      let googleBody: GoogleDirectionsBody | null = primary.body
      let effectiveMode: 'transit' | 'driving' | 'walking' = requestedMode
      let fallbackApplied = false

      // In remote/sparse areas transit can return ZERO_RESULTS even when walking is valid.
      // For the “公交 + 步行” tab (allowWalkFallback 默认开), transparently retry with
      // pure walking.需要把 ZERO_RESULTS 与步行回退区分开的调用方传 allowWalkFallback=0。
      if (requestedMode === 'transit' && allowWalkFallback && googleBody?.status === 'ZERO_RESULTS') {
        const walkingFallback = await fetchGoogleDirections({
          origin,
          destination,
          mode: 'walking',
          waypoints,
          apiKey: deps.apiKey,
        })
        if (walkingFallback.ok && walkingFallback.body?.status === 'OK') {
          googleBody = walkingFallback.body
          effectiveMode = 'walking'
          fallbackApplied = true
        }
      }

      if (googleBody?.status !== 'OK') {
        const status = String(googleBody?.status || 'UNKNOWN') as GoogleApiStatus
        const message = String(googleBody?.error_message || '')

        console.error('[directions] Google API status', status, message)

        if (status === 'ZERO_RESULTS') {
          const errorMessage =
            requestedMode === 'transit'
              ? allowWalkFallback
                ? '未找到可用公共交通，且步行回退也无可用路线'
                : '该出行方式下未找到路线（ZERO_RESULTS）'
              : '未找到路线'
          return NextResponse.json({ error: errorMessage, code: 'ZERO_RESULTS' }, { status: 400 })
        }
        if (status === 'REQUEST_DENIED' || status === 'OVER_QUERY_LIMIT') {
          const hint =
            status === 'REQUEST_DENIED'
              ? '路线服务暂不可用（API 配置异常），请稍后重试或使用 Google Maps 链接查看路线'
              : '路线查询次数已达上限，请稍后再试'
          return NextResponse.json({ error: hint }, { status: 502 })
        }
        if (status === 'NOT_FOUND' || status === 'MAX_WAYPOINTS_EXCEEDED' || status === 'INVALID_REQUEST') {
          if (status === 'INVALID_REQUEST' && requestedMode === 'transit') {
            if (/waypoint/i.test(message)) {
              return NextResponse.json(
                { error: '公共交通模式下不支持当前途经点组合，请减少中间点后重试' },
                { status: 400 },
              )
            }
          }
          const clientMsg =
            status === 'MAX_WAYPOINTS_EXCEEDED'
              ? '途经点过多，请减少路线点位后重试'
              : '请求参数有误，请检查路线点位'
          return NextResponse.json({ error: clientMsg }, { status: 400 })
        }

        return NextResponse.json(
          { error: '路线服务暂时不可用，请稍后重试' },
          { status: 502 },
        )
      }

      // routes 为空/缺首个 route 对象 → 400（历史行为）；route 存在但 legs 为空仍算成功
      const firstRoute = googleBody?.routes?.[0]
      if (!firstRoute || typeof firstRoute !== 'object') {
        return NextResponse.json({ error: '未找到路线' }, { status: 400 })
      }

      const legs: DirectionLeg[] = parseRouteLegs(googleBody)

      const result: DirectionsResult = {
        ok: true,
        legs,
        mode: effectiveMode,
        requestedMode,
        fallbackApplied,
      }

      // Cache result
      setCache(key, result)

      return NextResponse.json(result)
    },
  }
}
