/**
 * Google Places 地点解析（M3）：把用户口中的非巡礼地点（如"东京迪士尼"）解析成
 * 可落库的结构化地点。仅服务端使用；API key 只出现在对 Google 的请求里，
 * 绝不进入任何返回给模型/前端/落库的字段。
 *
 * 设计约束（docs/superpowers/specs/2026-09-02-plan-agent-external-place-store-design.md §5.2）：
 * - 解析阶梯：内存缓存 → 地点库（ExternalPlaceStore，30 天 TTL）→ Google Text Search；
 * - 首次解析后 upsert 入库并触发 onResolved（后台照片镜像）；
 * - 支持 near 位置偏置（当天坐标质心 + 半径）；
 * - 文本搜索取第一个结果自动选定；无结果返回 typed 错误，绝不编造坐标；
 * - placeId/查询双键的有界缓存 + 每调用方限速，避免重复烧 Places 配额；
 * - 图片只保留 opaque photo reference + 站内 keyless 代理 URL（按 placeId 寻址）。
 */

import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'

export type PlacePhotoMeta = {
  /** Google photo reference（opaque token，非机密） */
  photoReference: string
  /** 站内 keyless 展示 URL（相对路径，浏览器同源带 cookie 访问） */
  displayUrl: string
  /** 署名（纯文本） */
  attribution: string | null
}

/** 地点的多照片引用（Place Details 补拉后最多 10 张；仅 opaque token + 纯文本署名） */
export type PlacePhotoRef = { photoReference: string; attribution: string | null }

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
  /** 已知照片引用列表（Text Search / Nearby 只回 1 张，此时 photos = [photo]） */
  photos?: PlacePhotoRef[]
  fetchedAt: string
}

export type PlaceErrorCode =
  | 'config_error'
  | 'not_found'
  | 'provider_error'
  | 'rate_limited'
  | 'invalid_query'

export type PlaceResolution =
  | { ok: true; place: ResolvedPlace; fromCache: boolean }
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
// R3：8 → 60（每计划每分钟）。Google Maps 每月免费额度 Essentials 10k/Pro 5k 次，
// 实际用量远低于此；8 次/分钟曾令 19 餐计划一次保存只解析 6 处就全数 pending
const RATE_MAX_CALLS = 60
const FETCH_TIMEOUT_MS = 8_000

/** photo reference 的合法字符集（Google token 是 URL 安全的 ASCII） */
const PHOTO_REF_PATTERN = /^[A-Za-z0-9_\-.+]+$/

/** Google placeId 的合法形状（URL 安全 ASCII，典型 22 字符的 ChIJ... token） */
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,300}$/

export function isValidPhotoReference(ref: string): boolean {
  const value = String(ref || '').trim()
  // 回归第五轮 R2：Google Nearby 的 photo_reference 实测已到 644–671 字符，
  // 旧上限 512 会把每家餐厅的照片全部丢弃；放宽到 4096（字符集不变）
  return value.length >= 8 && value.length <= 4096 && PHOTO_REF_PATTERN.test(value)
}

export function isValidPlaceId(id: string): boolean {
  return PLACE_ID_PATTERN.test(String(id || '').trim())
}

/**
 * 查询词归一化：NFKC → 小写 → 去掉末尾括注（「（抵达）」/「(arrival)」）→
 * 空白折叠 → trim。地点库的 normalizedQuery 键依赖它的稳定性。
 */
export function normalizePlaceQuery(raw: string): string {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(][^（）()]*[）)]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 构建站内 keyless 图片代理 URL（placeId/photoReference 本身是 opaque token，不含密钥）；index > 0 时追加 &i=<n>（保证现有 URL 与 R2 key 不变） */
export function buildPlacePhotoDisplayUrl(
  input: { placeId: string; index?: number } | { photoReference: string },
  maxWidth = 1600,
): string {
  if ('placeId' in input) {
    const base = `/api/google/place-photo?placeId=${encodeURIComponent(input.placeId)}&maxwidth=${maxWidth}`
    return input.index && input.index > 0 ? `${base}&i=${input.index}` : base
  }
  return `/api/google/place-photo?ref=${encodeURIComponent(input.photoReference)}&maxwidth=${maxWidth}`
}

/**
 * 判定 displayUrl 是否是"安全的站内 Google photo 代理 URL"：
 * 必须是指向 /api/google/place-photo 的相对路径、ref 或 placeId 至少一个通过
 * opaque token 校验、且不带任何密钥类参数。save_plan_days 的 media 派生防线
 * 只接受这种 URL——任意外部 URL 一律不认，不引入第二套图片策略，也不绕过
 * 代理的 SSRF/MIME 防线。
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
  const placeId = url.searchParams.get('placeId') ?? ''
  if (!isValidPhotoReference(ref) && !isValidPlaceId(placeId)) return false
  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase() === 'key' || key.toLowerCase() === 'apikey' || key.toLowerCase() === 'token') return false
  }
  return true
}

export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim()
}

export function mapsUriForPlaceId(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`
}

/**
 * Places 家族（Text Search 解析 / Nearby Search 餐厅搜索）可共享的限速窗口：
 * 同一 rateKey 命名空间内合计 RATE_MAX_CALLS 次/分钟。serverDeps 装配时把
 * 同一实例传给 resolver 与 nearby，保证单计划总配额有界。
 */
export type PlacesRateWindow = { check(key: string): boolean }

export function createPlacesRateWindow(options?: { now?: () => number; maxCalls?: number }): PlacesRateWindow {
  const now = options?.now ?? (() => Date.now())
  const maxCalls = options?.maxCalls ?? RATE_MAX_CALLS
  const windows = new Map<string, { count: number; windowStart: number }>()
  return {
    check(key: string): boolean {
      const window = windows.get(key)
      const timestamp = now()
      if (!window || timestamp - window.windowStart > RATE_WINDOW_MS) {
        windows.set(key, { count: 1, windowStart: timestamp })
        return true
      }
      if (window.count >= maxCalls) return false
      window.count += 1
      return true
    },
  }
}

type CacheEntry = { place: ResolvedPlace; expiresAt: number }

export type ResolveByTextOptions = {
  /** 位置偏置（当天坐标质心等）：Text Search 的 location + radius 参数 */
  near?: { lat: number; lng: number }
  radiusM?: number
  /**
   * 真实发起 Google 请求之前回调一次（内存缓存/地点库命中与限速拒绝不回调；
   * 请求失败或抛错同样已回调）——plan agent 用它按真实外呼计量预算。
   */
  onGoogleCall?: () => void
}

export type PlaceResolverDeps = {
  apiKey: string
  /** 可注入的 fetch（测试用）；默认全局 fetch */
  fetchImpl?: typeof fetch
  /** 限速命名空间（如 planId）；同 key 共享 8 次/分钟窗口 */
  rateKey?: string
  /** 共享限速窗口（如与 Nearby Search 合计配额）；缺省私有窗口 */
  rateWindow?: PlacesRateWindow
  now?: () => number
  /** 地点库（Postgres；缺省只用内存缓存）。库抛错时降级为无库模式 */
  store?: ExternalPlaceStore
  /**
   * 是否把查询词写入 ExternalPlaceQuery（缺省 true）。false 时 upsert 只落
   * 地点行（第二参数 null）、也不查 findByQuery（只查内存与 placeId）——
   * point-photo 的解析词多是「踏切」「阶段」这类泛词，写进查询词表会污染
   * 计划 agent 的 findByQuery（R4）。
   */
  persistQuery?: boolean
  /** 首次解析（打了 Google）后的回调：触发后台照片镜像等 */
  onResolved?: (place: ResolvedPlace) => void
}

export type PlaceResolver = {
  resolveByText(query: string, opts?: ResolveByTextOptions): Promise<PlaceResolution>
  /**
   * 按 placeId 查已解析过的地点（内存缓存 → 地点库；不打 Google）。
   * save_plan_days 用它验证"外部地点确实是本计划解析出来的"，防止编造。
   */
  lookup(placeId: string): Promise<ResolvedPlace | null>
  /**
   * 把兄弟服务（如 Nearby Search）取得的地点写入内存缓存，令 save_plan_days
   * 的出处校验能命中（lookup(placeId) 直接返回，不打 Google）。
   */
  remember(place: ResolvedPlace): void
}

export function createPlaceResolver(deps: PlaceResolverDeps): PlaceResolver {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => Date.now())
  const queryCache = new Map<string, CacheEntry>()
  const placeCache = new Map<string, CacheEntry>()
  const rateWindow = deps.rateWindow ?? createPlacesRateWindow({ now })

  function rememberQuery(place: ResolvedPlace, queryKey: string): void {
    if (queryCache.size >= CACHE_MAX_ENTRIES) {
      const oldest = queryCache.keys().next().value
      if (oldest !== undefined) queryCache.delete(oldest)
    }
    queryCache.set(queryKey, { place, expiresAt: now() + CACHE_TTL_MS })
    rememberPlace(place)
  }

  function rememberPlace(place: ResolvedPlace): void {
    if (placeCache.size >= CACHE_MAX_ENTRIES) {
      const oldest = placeCache.keys().next().value
      if (oldest !== undefined) placeCache.delete(oldest)
    }
    placeCache.set(place.placeId, { place, expiresAt: now() + CACHE_TTL_MS })
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

  /** 地点库调用的统一降级：任何库错误都不打断解析，只 warn 后按"无库"继续 */
  async function safeStore<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      return await action()
    } catch (err) {
      console.warn('[googlePlaces] store unavailable', err)
      return null
    }
  }

  /**
   * upsert 落库的降级包装：upsert 返回 void，成功与失败无法从返回值区分，
   * 这里统一收敛为布尔（成功 true；store 缺省/抛错 false）。
   */
  async function upsertToStore(place: ResolvedPlace, normalizedQuery: string | null): Promise<boolean> {
    if (!deps.store) return false
    return (
      (await safeStore(async () => {
        await deps.store!.upsert(place, normalizedQuery)
        return true
      })) === true
    )
  }

  return {
    async lookup(placeId: string): Promise<ResolvedPlace | null> {
      const key = String(placeId || '').trim()
      if (!key) return null
      const cached = cachedPlace(key)
      if (cached) return cached
      const record = deps.store ? await safeStore(() => deps.store!.findByPlaceId('google', key)) : null
      if (record) {
        rememberPlace(record)
        return record
      }
      return null
    },
    remember(place: ResolvedPlace): void {
      rememberPlace(place)
    },
    async resolveByText(query: string, opts?: ResolveByTextOptions): Promise<PlaceResolution> {
      const trimmed = String(query || '').trim()
      if (!trimmed) return { ok: false, code: 'invalid_query', message: '地点关键词不能为空' }
      if (!deps.apiKey) {
        return { ok: false, code: 'config_error', message: 'Google Places 服务未配置（缺少 API key）' }
      }

      const persistQuery = deps.persistQuery !== false
      const queryKey = normalizePlaceQuery(trimmed)
      const cached = cachedQuery(queryKey)
      if (cached) return { ok: true, place: cached, fromCache: true }

      if (deps.store && persistQuery) {
        const record = await safeStore(() => deps.store!.findByQuery('google', queryKey))
        if (record) {
          rememberQuery(record, queryKey)
          return { ok: true, place: record, fromCache: true }
        }
      }

      if (!rateWindow.check(deps.rateKey ?? 'global')) {
        return { ok: false, code: 'rate_limited', message: '地点解析请求过于频繁，请稍后再试' }
      }

      // 真实外呼前计数（N3）：失败与抛错路径同样已计数，缓存/库命中不会走到这里
      opts?.onGoogleCall?.()
      let body: PlacesApiBody | null = null
      try {
        const params = new URLSearchParams({ query: trimmed, key: deps.apiKey, language: 'zh-CN' })
        if (opts?.near && Number.isFinite(opts.near.lat) && Number.isFinite(opts.near.lng)) {
          params.set('location', `${opts.near.lat},${opts.near.lng}`)
          params.set('radius', String(Math.min(50_000, Math.max(100, Math.floor(opts.radiusM ?? 30_000)))))
        }
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
              // 默认 ref 寻址（不依赖地点库可用性）；落库确认成功后再升级 placeId 寻址
              displayUrl: buildPlacePhotoDisplayUrl({ photoReference: rawPhoto.photo_reference }),
              attribution: rawPhoto.html_attributions?.[0] ? stripHtml(rawPhoto.html_attributions[0]) : null,
            }
          : null,
        // Text Search 只回 1 张：photos 与 photo 对齐（多照片由 Place Details 补拉后回写）
        ...(rawPhoto?.photo_reference
          ? {
              photos: [
                {
                  photoReference: rawPhoto.photo_reference,
                  attribution: rawPhoto.html_attributions?.[0] ? stripHtml(rawPhoto.html_attributions[0]) : null,
                },
              ],
            }
          : {}),
        fetchedAt: new Date(now()).toISOString(),
      }
      // placeId 寻址依赖地点库：store 缺省或 upsert 抛错（库不可用/迁移未跑）时
      // 必须保持 ref 形式，否则落库的 displayUrl 会永久 404。
      // persistQuery=false（点位解析器）只落地点行、不写查询词（R4）
      const stored = await upsertToStore(place, persistQuery ? (queryKey || null) : null)
      if (stored && place.photo) {
        place.photo.displayUrl = buildPlacePhotoDisplayUrl({ placeId: place.placeId })
      }
      rememberQuery(place, queryKey)
      try {
        deps.onResolved?.(place)
      } catch (err) {
        console.warn('[googlePlaces] onResolved callback failed', err)
      }
      return { ok: true, place, fromCache: false }
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
