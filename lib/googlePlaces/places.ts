/**
 * Google Places 地点解析（M3）：把用户口中的非巡礼地点（如"东京迪士尼"）解析成
 * 可落库的结构化地点。仅服务端使用；API key 只出现在对 Google 的请求里，
 * 绝不进入任何返回给模型/前端/落库的字段。
 *
 * 设计约束（docs/superpowers/plans/2026-09-01-plan-agent-m3-interaction-upgrade.md §5）：
 * - 文本搜索取第一个结果自动选定；无结果返回 typed 错误，绝不编造坐标。
 * - placeId/查询双键的有界缓存 + 每调用方限速，避免重复烧 Places 配额。
 * - 图片只保留 opaque photo reference + 站内 keyless 代理 URL。
 */

export type PlacePhotoMeta = {
  /** Google photo reference（opaque token，非机密） */
  photoReference: string
  /** 站内 keyless 展示 URL（相对路径，浏览器同源带 cookie 访问） */
  displayUrl: string
  /** 署名（纯文本） */
  attribution: string | null
}

/** 落库到 TripPlanItem.payload.place 的结构 */
export type ResolvedPlace = {
  provider: 'google'
  placeId: string
  name: string
  address: string | null
  lat: number
  lng: number
  /** https://www.google.com/maps/place/?q=place_id:... */
  mapsUri: string
  photo: PlacePhotoMeta | null
  fetchedAt: string
}

export type PlaceErrorCode =
  | 'config_error'
  | 'not_found'
  | 'provider_error'
  | 'rate_limited'
  | 'invalid_query'

export type PlaceResolution =
  | { ok: true; place: ResolvedPlace }
  | { ok: false; code: PlaceErrorCode; message: string }

type PlacesApiBody = {
  status?: string
  error_message?: string
  results?: Array<{
    place_id?: string
    name?: string
    formatted_address?: string
    geometry?: { location?: { lat?: number; lng?: number } }
    photos?: Array<{
      photo_reference?: string
      html_attributions?: string[]
    }>
  }>
}

const CACHE_MAX_ENTRIES = 200
const CACHE_TTL_MS = 30 * 60 * 1000
const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX_CALLS = 8
const FETCH_TIMEOUT_MS = 8_000

/** photo reference 的合法字符集（Google token 是 URL 安全的 ASCII） */
const PHOTO_REF_PATTERN = /^[A-Za-z0-9_\-.+]+$/

export function isValidPhotoReference(ref: string): boolean {
  const value = String(ref || '').trim()
  return value.length >= 8 && value.length <= 512 && PHOTO_REF_PATTERN.test(value)
}

/** 构建站内 keyless 图片代理 URL（photo reference 本身是 opaque token，不含密钥） */
export function buildPlacePhotoDisplayUrl(photoReference: string, maxWidth = 1600): string {
  const ref = encodeURIComponent(photoReference)
  return `/api/google/place-photo?ref=${ref}&maxwidth=${maxWidth}`
}

/**
 * 判定 displayUrl 是否是"安全的站内 Google photo 代理 URL"：
 * 必须是指向 /api/google/place-photo 的相对路径、ref 通过 opaque token 校验、
 * 且不带任何密钥类参数。save_plan_days 的 media 派生防线只接受这种 URL——
 * 任意外部 URL 一律不认，不引入第二套图片策略，也不绕过代理的 SSRF/MIME 防线。
 */
export function isSafePlacePhotoDisplayUrl(raw: string): boolean {
  const value = String(raw || '').trim()
  if (!value || value.startsWith('//')) return false
  let url: URL
  try {
    url = new URL(value, 'https://place-photo.invalid')
  } catch {
    return false
  }
  // 必须是相对路径（落在我们自己的 origin 上），不接受任何绝对外部地址
  if (url.origin !== 'https://place-photo.invalid') return false
  if (url.username || url.password) return false
  if (url.pathname !== '/api/google/place-photo') return false
  const ref = url.searchParams.get('ref') ?? ''
  if (!isValidPhotoReference(ref)) return false
  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase() === 'key' || key.toLowerCase() === 'apikey' || key.toLowerCase() === 'token') return false
  }
  return true
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim()
}

function mapsUriForPlaceId(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`
}

type CacheEntry = { place: ResolvedPlace; expiresAt: number }

export type PlaceResolverDeps = {
  apiKey: string
  /** 可注入的 fetch（测试用）；默认全局 fetch */
  fetchImpl?: typeof fetch
  /** 限速命名空间（如 planId）；同 key 共享 8 次/分钟窗口 */
  rateKey?: string
  now?: () => number
}

export type PlaceResolver = {
  resolveByText(query: string): Promise<PlaceResolution>
  /**
   * 按 placeId 查已解析过的地点（仅命中本 resolver 的缓存；不发网络请求）。
   * save_plan_days 用它验证"外部地点确实是本计划解析出来的"，防止编造。
   */
  lookup(placeId: string): ResolvedPlace | null
}

export function createPlaceResolver(deps: PlaceResolverDeps): PlaceResolver {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => Date.now())
  const queryCache = new Map<string, CacheEntry>()
  const placeCache = new Map<string, CacheEntry>()
  const rateWindows = new Map<string, { count: number; windowStart: number }>()

  function checkRate(key: string): boolean {
    const window = rateWindows.get(key)
    const timestamp = now()
    if (!window || timestamp - window.windowStart > RATE_WINDOW_MS) {
      rateWindows.set(key, { count: 1, windowStart: timestamp })
      return true
    }
    if (window.count >= RATE_MAX_CALLS) return false
    window.count += 1
    return true
  }

  function remember(place: ResolvedPlace, queryKey: string): void {
    const expiresAt = now() + CACHE_TTL_MS
    if (queryCache.size >= CACHE_MAX_ENTRIES) {
      const oldest = queryCache.keys().next().value
      if (oldest !== undefined) queryCache.delete(oldest)
    }
    if (placeCache.size >= CACHE_MAX_ENTRIES) {
      const oldest = placeCache.keys().next().value
      if (oldest !== undefined) placeCache.delete(oldest)
    }
    queryCache.set(queryKey, { place, expiresAt })
    placeCache.set(place.placeId, { place, expiresAt })
  }

  function cachedQuery(key: string): ResolvedPlace | null {
    const entry = queryCache.get(key)
    if (!entry) return null
    if (now() > entry.expiresAt) {
      queryCache.delete(key)
      return null
    }
    return entry.place
  }

  function cachedPlace(placeId: string): ResolvedPlace | null {
    const entry = placeCache.get(placeId)
    if (!entry) return null
    if (now() > entry.expiresAt) {
      placeCache.delete(placeId)
      return null
    }
    return entry.place
  }

  return {
    lookup(placeId: string): ResolvedPlace | null {
      const key = String(placeId || '').trim()
      return key ? cachedPlace(key) : null
    },
    async resolveByText(query: string): Promise<PlaceResolution> {
      const trimmed = String(query || '').trim()
      if (!trimmed) return { ok: false, code: 'invalid_query', message: '地点关键词不能为空' }
      if (!deps.apiKey) {
        return { ok: false, code: 'config_error', message: 'Google Places 服务未配置（缺少 API key）' }
      }

      const queryKey = trimmed.toLowerCase()
      const cached = cachedQuery(queryKey)
      if (cached) return { ok: true, place: cached }

      if (!checkRate(deps.rateKey ?? 'global')) {
        return { ok: false, code: 'rate_limited', message: '地点解析请求过于频繁，请稍后再试' }
      }

      let body: PlacesApiBody | null = null
      try {
        const params = new URLSearchParams({ query: trimmed, key: deps.apiKey, language: 'zh-CN' })
        const res = await fetchImpl(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!res.ok) {
          return { ok: false, code: 'provider_error', message: 'Google Places 服务暂时不可用' }
        }
        body = (await res.json().catch(() => null)) as PlacesApiBody | null
      } catch {
        return { ok: false, code: 'provider_error', message: '地点解析请求失败（网络超时）' }
      }

      const status = body?.status ?? 'UNKNOWN'
      if (status === 'REQUEST_DENIED') {
        // key 缺 Places API 权限是配置问题，必须显式暴露而不是伪装成"没找到"
        return {
          ok: false,
          code: 'config_error',
          message: 'Google Places API 未启用或无权限（REQUEST_DENIED），请检查服务端 key 配置',
        }
      }
      if (status === 'OVER_QUERY_LIMIT') {
        return { ok: false, code: 'rate_limited', message: 'Google Places 配额已用尽，请稍后再试' }
      }
      if (status === 'INVALID_REQUEST') {
        return { ok: false, code: 'invalid_query', message: '地点查询参数不合法' }
      }
      if (status !== 'OK' && status !== 'ZERO_RESULTS') {
        return { ok: false, code: 'provider_error', message: `Google Places 返回异常状态：${status}` }
      }

      const first = body?.results?.find((r) => typeof r.place_id === 'string' && r.place_id)
      if (!first || !first.place_id) {
        return { ok: false, code: 'not_found', message: `Google 没有找到「${trimmed}」对应的地点` }
      }
      const lat = first.geometry?.location?.lat
      const lng = first.geometry?.location?.lng
      if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { ok: false, code: 'provider_error', message: 'Google 返回的地点缺少坐标' }
      }

      const rawPhoto = first.photos?.find((p) => typeof p.photo_reference === 'string' && isValidPhotoReference(p.photo_reference))
      const place: ResolvedPlace = {
        provider: 'google',
        placeId: first.place_id,
        name: first.name ?? trimmed,
        address: first.formatted_address ?? null,
        lat,
        lng,
        mapsUri: mapsUriForPlaceId(first.place_id),
        photo: rawPhoto?.photo_reference
          ? {
              photoReference: rawPhoto.photo_reference,
              displayUrl: buildPlacePhotoDisplayUrl(rawPhoto.photo_reference),
              attribution: rawPhoto.html_attributions?.[0] ? stripHtml(rawPhoto.html_attributions[0]) : null,
            }
          : null,
        fetchedAt: new Date(now()).toISOString(),
      }
      remember(place, queryKey)
      return { ok: true, place }
    },
  }
}

/**
 * 校验 save_plan_days 传入的 payload.place 形状（外部点位合法性）。
 * 返回 null 表示合法；否则返回中文错误描述。
 */
export function validateExternalPlacePayload(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'payload.place 必须是对象'
  }
  const place = value as Record<string, unknown>
  if (typeof place.placeId !== 'string' || !place.placeId.trim()) return 'payload.place.placeId 不能为空'
  if (typeof place.name !== 'string' || !place.name.trim()) return 'payload.place.name 不能为空'
  const lat = Number(place.lat)
  const lng = Number(place.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'payload.place.lat/lng 必须是数字'
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return 'payload.place.lat/lng 超出合法范围'
  return null
}
