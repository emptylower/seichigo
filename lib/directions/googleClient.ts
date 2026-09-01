/**
 * Google Directions 共享客户端（M3 从 handlers/directions.ts 抽出）：
 * 公共 /api 路由与 plan agent 的 estimate_travel 工具共用同一套解析，
 * 不引入第二份不兼容的 Google 客户端。
 *
 * 关键契约（docs/superpowers/plans/2026-09-01-plan-agent-m3-interaction-upgrade.md §7）：
 * - 支持 walking / transit / driving，可选 departure_time（精确日期时用真实日期查询）；
 * - 完整保留 leg/step（含步行段、线路名/车次、上下车站、站数、时长、距离、指示）；
 * - requestTravel 对 transit ZERO_RESULTS **不做**任何步行静默转换，返回可区分的
 *   typed 错误，让 agent 去问用户是否改驾车/租车。
 */

export type TransitDetail = {
  lineName: string
  departureStop: string
  arrivalStop: string
  numStops: number
  departureTime?: string
  arrivalTime?: string
  headsign?: string
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

export type GoogleDirectionsBody = {
  status?: string
  error_message?: string
  routes?: unknown[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseStep(raw: any): DirectionStep {
  const transitDetails: TransitDetail | null = raw.transit_details
    ? {
        lineName: raw.transit_details.line?.short_name || raw.transit_details.line?.name || '',
        departureStop: raw.transit_details.departure_stop?.name || '',
        arrivalStop: raw.transit_details.arrival_stop?.name || '',
        numStops: raw.transit_details.num_stops ?? 0,
        ...(raw.transit_details.departure_time?.text ? { departureTime: String(raw.transit_details.departure_time.text) } : {}),
        ...(raw.transit_details.arrival_time?.text ? { arrivalTime: String(raw.transit_details.arrival_time.text) } : {}),
        ...(raw.transit_details.headsign ? { headsign: String(raw.transit_details.headsign) } : {}),
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

/** 解析首条路线的全部 legs（status 已由调用方判定为 OK；null 安全） */
export function parseRouteLegs(body: GoogleDirectionsBody | null): DirectionLeg[] {
  const route = body?.routes?.[0]
  if (!route || typeof route !== 'object') return []
  const rawLegs = Array.isArray((route as Record<string, unknown>).legs)
    ? ((route as Record<string, unknown>).legs as unknown[])
    : []
  return rawLegs.map(parseLeg)
}

/** 读取首条路线的 overview_polyline 原文（无则 null） */
export function readOverviewPolyline(body: GoogleDirectionsBody | null): string | null {
  const route = body?.routes?.[0]
  if (!route || typeof route !== 'object') return null
  const encoded = (route as Record<string, unknown>).overview_polyline
  if (!encoded || typeof encoded !== 'object') return null
  const points = (encoded as Record<string, unknown>).points
  return typeof points === 'string' && points ? points : null
}

/**
 * Google encoded polyline 解码。返回 [lat, lng] 数组（与 GeoJSON 的 [lng,lat]
 * 相反，调用方按需换序），坐标保留 5 位小数精度。
 */
export function decodePolyline(encoded: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    result = 0
    shift = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    out.push([Math.round(lat) / 1e5, Math.round(lng) / 1e5])
  }
  return out
}

export type GoogleTravelMode = 'walking' | 'transit' | 'driving'

export type FetchGoogleDirectionsInput = {
  origin: string
  destination: string
  mode: GoogleTravelMode
  waypoints?: string
  /** 出发时刻（epoch 秒）：计划有精确日期时传入，Google 按该时刻的现实班次计算 */
  departureTimeSec?: number
  apiKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type FetchGoogleDirectionsResult = {
  ok: boolean
  httpStatus: number
  body: GoogleDirectionsBody | null
}

export async function fetchGoogleDirections(input: FetchGoogleDirectionsInput): Promise<FetchGoogleDirectionsResult> {
  const params = new URLSearchParams({
    origin: input.origin,
    destination: input.destination,
    mode: input.mode,
    key: input.apiKey,
    language: 'zh-CN',
  })
  if (input.waypoints) params.set('waypoints', input.waypoints)
  if (typeof input.departureTimeSec === 'number' && Number.isFinite(input.departureTimeSec)) {
    params.set('departure_time', String(Math.floor(input.departureTimeSec)))
  }

  const fetchImpl = input.fetchImpl ?? fetch
  const res = await fetchImpl(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`, {
    signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
  })
  if (!res.ok) return { ok: false, httpStatus: res.status, body: null }
  const body = (await res.json().catch(() => null)) as GoogleDirectionsBody | null
  return { ok: true, httpStatus: res.status, body }
}

export type TravelErrorCode =
  | 'config_error'
  | 'zero_results'
  | 'rate_limited'
  | 'provider_error'
  | 'network_error'

export type TravelLegSummary = DirectionLeg

export type TravelResult =
  | {
      ok: true
      mode: GoogleTravelMode
      legs: TravelLegSummary[]
      durationSeconds: number
      distanceMeters: number
      /** 换乘次数（TRANSIT step 数 - 1，负数归零） */
      transfers: number
      walkSeconds: number
      transitSeconds: number
      /** overview_polyline 解码后的 [lat, lng] 序列（无则空数组） */
      polyline: Array<[number, number]>
      departureTimeSec?: number
    }
  | { ok: false; code: TravelErrorCode; message: string }

/**
 * agent 用的真实交通查询：一次 Google Directions 调用，ZERO_RESULTS 保持为
 * 可区分的 typed 错误（绝不静默转步行）。软硬触发公共交通不便判定的原始
 * 数据（transfers / walkSeconds / duration）都在返回值里。
 */
export async function requestTravel(input: {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  mode: GoogleTravelMode
  departureTimeSec?: number
  apiKey: string
  fetchImpl?: typeof fetch
}): Promise<TravelResult> {
  if (!input.apiKey) {
    return { ok: false, code: 'config_error', message: 'Google Directions 服务未配置（缺少 API key）' }
  }
  const origin = `${input.origin.lat},${input.origin.lng}`
  const destination = `${input.destination.lat},${input.destination.lng}`

  let fetched: FetchGoogleDirectionsResult
  try {
    fetched = await fetchGoogleDirections({
      origin,
      destination,
      mode: input.mode,
      departureTimeSec: input.departureTimeSec,
      apiKey: input.apiKey,
      fetchImpl: input.fetchImpl,
    })
  } catch {
    return { ok: false, code: 'network_error', message: '交通查询请求失败（网络超时）' }
  }

  if (!fetched.ok) {
    return { ok: false, code: 'provider_error', message: 'Google Directions 服务暂时不可用' }
  }

  const status = fetched.body?.status ?? 'UNKNOWN'
  if (status === 'ZERO_RESULTS') {
    return {
      ok: false,
      code: 'zero_results',
      message:
        input.mode === 'transit'
          ? '该路段没有查到可用的公共交通路线（可能是偏远/覆盖差地区）。不要把行程悄悄改成纯步行——用 ask_user 问用户是否接受自驾/租车、混合方式或其他方案'
          : '该路段没有查到可用路线',
    }
  }
  if (status === 'REQUEST_DENIED') {
    return { ok: false, code: 'config_error', message: 'Google Directions API 未启用或无权限（REQUEST_DENIED）' }
  }
  if (status === 'OVER_QUERY_LIMIT') {
    return { ok: false, code: 'rate_limited', message: 'Google Directions 配额已用尽，请稍后再试' }
  }
  if (status !== 'OK') {
    return { ok: false, code: 'provider_error', message: `Google Directions 返回异常状态：${status}` }
  }

  const legs = parseRouteLegs(fetched.body)
  if (!legs.length) {
    return { ok: false, code: 'zero_results', message: '未找到路线' }
  }

  const steps = legs.flatMap((leg) => leg.steps)
  const transitSteps = steps.filter((s) => s.travelMode === 'TRANSIT')
  const walkSeconds = steps
    .filter((s) => s.travelMode === 'WALKING')
    .reduce((sum, s) => sum + s.durationSeconds, 0)
  const transitSeconds = transitSteps.reduce((sum, s) => sum + s.durationSeconds, 0)
  const durationSeconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0)
  const distanceMeters = legs.reduce((sum, leg) => sum + leg.distanceMeters, 0)

  const encodedPolyline = readOverviewPolyline(fetched.body)
  const polyline = encodedPolyline ? decodePolyline(encodedPolyline) : []

  return {
    ok: true,
    mode: input.mode,
    legs,
    durationSeconds,
    distanceMeters,
    transfers: Math.max(0, transitSteps.length - 1),
    walkSeconds,
    transitSeconds,
    polyline,
    ...(typeof input.departureTimeSec === 'number' && Number.isFinite(input.departureTimeSec)
      ? { departureTimeSec: Math.floor(input.departureTimeSec) }
      : {}),
  }
}

// ---------------------------------------------------------------------------
// Per-plan travel client：限速 + 有界缓存（M3 修订：agent 的 Directions 调用
// 也必须有边界，且各计划的配额/缓存互不共享）
// ---------------------------------------------------------------------------

export type TravelClientInput = {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  mode: GoogleTravelMode
  departureTimeSec?: number
}

export type TravelClientDeps = {
  apiKey: string
  /** 限速窗口上限（默认 15 次/分钟/计划） */
  rateMax?: number
  /** 缓存条目上限（默认 100，最旧先逐出） */
  cacheMax?: number
  cacheTtlMs?: number
  fetchImpl?: typeof fetch
  now?: () => number
}

const TRAVEL_RATE_WINDOW_MS = 60 * 1000
const TRAVEL_CACHE_TTL_MS = 10 * 60 * 1000

/**
 * 构造按计划隔离的 Directions 客户端：同一 (origin,destination,mode,departure)
 * 签名在 TTL 内直接命中缓存（只缓存成功结果，失败可重试）；超出限速窗口返回
 * typed rate_limited。每个计划持有独立实例，配额与缓存互不共享。
 */
export function createTravelClient(deps: TravelClientDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => Date.now())
  const rateMax = deps.rateMax ?? 15
  const cacheMax = deps.cacheMax ?? 100
  const cacheTtlMs = deps.cacheTtlMs ?? TRAVEL_CACHE_TTL_MS
  const cache = new Map<string, { result: Extract<TravelResult, { ok: true }>; expiresAt: number }>()
  let rateWindow = { count: 0, windowStart: 0 }

  function cacheKeyFor(input: TravelClientInput): string {
    return [
      input.origin.lat.toFixed(5),
      input.origin.lng.toFixed(5),
      input.destination.lat.toFixed(5),
      input.destination.lng.toFixed(5),
      input.mode,
      typeof input.departureTimeSec === 'number' && Number.isFinite(input.departureTimeSec)
        ? Math.floor(input.departureTimeSec)
        : '',
    ].join('|')
  }

  function checkRate(): boolean {
    const timestamp = now()
    if (timestamp - rateWindow.windowStart > TRAVEL_RATE_WINDOW_MS) {
      rateWindow = { count: 1, windowStart: timestamp }
      return true
    }
    if (rateWindow.count >= rateMax) return false
    rateWindow.count += 1
    return true
  }

  return async function travel(input: TravelClientInput): Promise<TravelResult> {
    const key = cacheKeyFor(input)
    const cached = cache.get(key)
    if (cached) {
      if (now() <= cached.expiresAt) return cached.result
      cache.delete(key)
    }
    if (!checkRate()) {
      return { ok: false, code: 'rate_limited', message: '本计划的交通查询过于频繁，请稍后再试' }
    }
    const result = await requestTravel({ ...input, apiKey: deps.apiKey, fetchImpl })
    if (result.ok) {
      if (cache.size >= cacheMax) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      cache.set(key, { result, expiresAt: now() + cacheTtlMs })
    }
    return result
  }
}
