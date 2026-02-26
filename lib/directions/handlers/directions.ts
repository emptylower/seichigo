import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransitDetail = {
  lineName: string
  departureStop: string
  arrivalStop: string
  numStops: number
}

export type DirectionStep = {
  travelMode: 'TRANSIT' | 'WALKING' | 'DRIVING'
  instruction: string
  duration: string
  durationSeconds: number
  distance: string
  distanceMeters: number
  transitDetails: TransitDetail | null
}

export type DirectionLeg = {
  startAddress: string
  endAddress: string
  duration: string
  durationSeconds: number
  distance: string
  distanceMeters: number
  steps: DirectionStep[]
}

export type DirectionsResult = {
  ok: true
  legs: DirectionLeg[]
}

// ---------------------------------------------------------------------------
// In-memory cache (key → { data, expiresAt })
// ---------------------------------------------------------------------------

type CacheEntry = { data: DirectionsResult; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function cacheKey(origin: string, destination: string, waypoints: string, mode: string) {
  return `${origin}|${destination}|${waypoints}|${mode}`
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

// ---------------------------------------------------------------------------
// Google Directions API response parsing
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseStep(raw: any): DirectionStep {
  const transitDetails: TransitDetail | null =
    raw.transit_details
      ? {
          lineName:
            raw.transit_details.line?.short_name ||
            raw.transit_details.line?.name ||
            '',
          departureStop: raw.transit_details.departure_stop?.name || '',
          arrivalStop: raw.transit_details.arrival_stop?.name || '',
          numStops: raw.transit_details.num_stops ?? 0,
        }
      : null

  return {
    travelMode: raw.travel_mode ?? 'WALKING',
    instruction: (raw.html_instructions ?? '').replace(/<[^>]*>/g, ''),
    duration: raw.duration?.text ?? '',
    durationSeconds: raw.duration?.value ?? 0,
    distance: raw.distance?.text ?? '',
    distanceMeters: raw.distance?.value ?? 0,
    transitDetails,
  }
}

function parseLeg(raw: any): DirectionLeg {
  return {
    startAddress: raw.start_address ?? '',
    endAddress: raw.end_address ?? '',
    duration: raw.duration?.text ?? '',
    durationSeconds: raw.duration?.value ?? 0,
    distance: raw.distance?.text ?? '',
    distanceMeters: raw.distance?.value ?? 0,
    steps: Array.isArray(raw.steps) ? raw.steps.map(parseStep) : [],
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
      const mode = url.searchParams.get('mode') || 'transit'
      const normalizedWaypoints = mode === 'transit' ? '' : waypoints

      if (!origin || !destination) {
        return NextResponse.json(
          { error: '缺少 origin 或 destination 参数' },
          { status: 400 },
        )
      }

      if (mode !== 'transit' && mode !== 'driving') {
        return NextResponse.json(
          { error: 'mode 必须为 transit 或 driving' },
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
      const key = cacheKey(origin, destination, normalizedWaypoints, mode)
      const cached = getCached(key)
      if (cached) {
        return NextResponse.json(cached)
      }

      // Build Google Directions API URL
      const params = new URLSearchParams({
        origin,
        destination,
        mode,
        key: deps.apiKey,
        language: 'zh-CN',
      })
      if (normalizedWaypoints) {
        params.set('waypoints', normalizedWaypoints)
      }

      const apiUrl = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`

      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) {
        console.error('[directions] Google API HTTP error', res.status)
        return NextResponse.json(
          { error: 'Google Directions API 请求失败' },
          { status: 502 },
        )
      }

      const body = await res.json()

      if (body.status !== 'OK') {
        console.error('[directions] Google API status', body.status, body.error_message)
        if (body.status === 'ZERO_RESULTS') {
          return NextResponse.json({ error: '未找到路线' }, { status: 400 })
        }
        if (body.status === 'REQUEST_DENIED' || body.status === 'OVER_QUERY_LIMIT') {
          // Config / quota issue — degrade gracefully instead of leaking raw status
          const hint =
            body.status === 'REQUEST_DENIED'
              ? '路线服务暂不可用（API 配置异常），请稍后重试或使用 Google Maps 链接查看路线'
              : '路线查询次数已达上限，请稍后再试'
          return NextResponse.json({ error: hint }, { status: 502 })
        }
        if (body.status === 'NOT_FOUND' || body.status === 'MAX_WAYPOINTS_EXCEEDED' || body.status === 'INVALID_REQUEST') {
          if (body.status === 'INVALID_REQUEST' && mode === 'transit') {
            const reason = String(body.error_message || '')
            if (/waypoint/i.test(reason)) {
              return NextResponse.json(
                { error: '公共交通模式下不支持当前途经点组合，请减少中间点后重试' },
                { status: 400 },
              )
            }
          }
          const clientMsg =
            body.status === 'MAX_WAYPOINTS_EXCEEDED'
              ? '途经点过多，请减少路线点位后重试'
              : '请求参数有误，请检查路线点位'
          return NextResponse.json({ error: clientMsg }, { status: 400 })
        }
        // Unknown status — generic message
        return NextResponse.json(
          { error: '路线服务暂时不可用，请稍后重试' },
          { status: 502 },
        )
      }

      // Parse routes
      const route = body.routes?.[0]
      if (!route) {
        return NextResponse.json({ error: '未找到路线' }, { status: 400 })
      }

      const legs: DirectionLeg[] = Array.isArray(route.legs)
        ? route.legs.map(parseLeg)
        : []

      const result: DirectionsResult = { ok: true, legs }

      // Cache result
      setCache(key, result)

      return NextResponse.json(result)
    },
  }
}
