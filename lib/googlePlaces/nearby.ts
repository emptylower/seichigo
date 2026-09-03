import {
  buildPlacePhotoDisplayUrl,
  createPlacesRateWindow,
  isValidPhotoReference,
  mapsUriForPlaceId,
  stripHtml,
  type PlaceErrorCode,
  type PlaceResolver,
  type PlacesRateWindow,
  type ResolvedPlace,
} from '@/lib/googlePlaces/places'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'

/**
 * Google Places Nearby Search（A3 餐厅推荐）：以坐标为中心搜索附近餐厅，
 * 供 plan agent 的 find_restaurants 工具使用。仅服务端使用；API key 只出现
 * 在对 Google 的请求里，绝不进入任何返回给模型/前端/落库的字段。
 *
 * 契约（回归修复计划 A3）：
 * - location=lat,lng&radius=<默认800>&type=restaurant&language=zh-CN（可选 keyword）；
 * - 筛选 rating ≥ 4.2 且 user_ratings_total ≥ 80；不足 3 家放宽到 ≥ 4.0 且 ≥ 30；
 * - 按 rating × log10(评价数 + 10) 降序取前 5；
 * - 每家组装成 ResolvedPlace 并 store.upsert(place, null)，同时写入 resolver
 *   内存缓存（remember），让 save_plan_days 的出处校验能命中；
 * - 限速与 resolver 共用同一 rateKey 窗口（serverDeps 注入同一实例）。
 */

export type NearbyRestaurant = ResolvedPlace & {
  rating: number
  userRatingsTotal: number
  priceLevel: number | null
}

export type NearbySearchResult =
  | { ok: true; restaurants: NearbyRestaurant[] }
  | { ok: false; code: PlaceErrorCode; message: string }

export type NearbySearchInput = {
  lat: number
  lng: number
  radiusM?: number
  keyword?: string
  /**
   * 真实发起 Google 请求之前回调一次（限速拒绝不回调；请求失败或抛错同样
   * 已回调）——plan agent 用它按真实外呼计量 places 预算。
   */
  onGoogleCall?: () => void
}

export type NearbySearchDeps = {
  apiKey: string
  fetchImpl?: typeof fetch
  rateKey?: string
  /** 与 resolver 共享的限速窗口（同一计划合计 8 次/分钟）；缺省私有窗口 */
  rateWindow?: PlacesRateWindow
  store?: ExternalPlaceStore
  /** 解析器实例：把结果写入其内存缓存供出处校验命中 */
  resolver?: PlaceResolver
  now?: () => number
}

export const NEARBY_RESTAURANT_DEFAULT_RADIUS_M = 800
const NEARBY_MAX_RESULTS = 5
const NEARBY_FETCH_TIMEOUT_MS = 8_000

type NearbyApiResult = {
  place_id?: string
  name?: string
  vicinity?: string
  geometry?: { location?: { lat?: number; lng?: number } }
  rating?: number
  user_ratings_total?: number
  price_level?: number
  photos?: Array<{ photo_reference?: string; html_attributions?: string[] }>
}

type NearbyApiBody = {
  status?: string
  error_message?: string
  results?: NearbyApiResult[]
}

export function createNearbySearch(deps: NearbySearchDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => Date.now())
  const rateWindow = deps.rateWindow ?? createPlacesRateWindow({ now })

  /** 库不可用/抛错只降级为未入库，绝不打断搜索结果；成功与否回传布尔 */
  async function upsertToStore(place: ResolvedPlace): Promise<boolean> {
    if (!deps.store) return false
    try {
      await deps.store.upsert(place, null)
      return true
    } catch (err) {
      console.warn('[googlePlaces] nearby store unavailable', err)
      return false
    }
  }

  return async function nearbyRestaurants(input: NearbySearchInput): Promise<NearbySearchResult> {
    const lat = Number(input.lat)
    const lng = Number(input.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { ok: false, code: 'invalid_query', message: '餐厅搜索坐标不合法' }
    }
    if (!deps.apiKey) {
      return { ok: false, code: 'config_error', message: 'Google Places 服务未配置（缺少 API key）' }
    }
    if (!rateWindow.check(deps.rateKey ?? 'global')) {
      return { ok: false, code: 'rate_limited', message: '餐厅搜索请求过于频繁，请稍后再试' }
    }

    const radiusM = Math.min(50_000, Math.max(100, Math.floor(Number(input.radiusM) || NEARBY_RESTAURANT_DEFAULT_RADIUS_M)))
    const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : ''
    const params = new URLSearchParams({
      location: `${lat},${lng}`,
      radius: String(radiusM),
      type: 'restaurant',
      language: 'zh-CN',
      key: deps.apiKey,
    })
    if (keyword) params.set('keyword', keyword)

    // 真实外呼前计数（N3）：失败与抛错路径同样已计数，限速拒绝不会走到这里
    input.onGoogleCall?.()
    let body: NearbyApiBody | null = null
    try {
      const res = await fetchImpl(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`, {
        signal: AbortSignal.timeout(NEARBY_FETCH_TIMEOUT_MS),
      })
      if (!res.ok) return { ok: false, code: 'provider_error', message: 'Google Places 服务暂时不可用' }
      body = (await res.json().catch(() => null)) as NearbyApiBody | null
    } catch {
      return { ok: false, code: 'provider_error', message: '餐厅搜索请求失败（网络超时）' }
    }

    const status = body?.status ?? 'UNKNOWN'
    if (status === 'REQUEST_DENIED') {
      return { ok: false, code: 'config_error', message: 'Google Places API 未启用或无权限（REQUEST_DENIED），请检查服务端 key 配置' }
    }
    if (status === 'OVER_QUERY_LIMIT') {
      return { ok: false, code: 'rate_limited', message: 'Google Places 配额已用尽，请稍后再试' }
    }
    if (status === 'INVALID_REQUEST') {
      return { ok: false, code: 'invalid_query', message: '餐厅搜索参数不合法' }
    }
    if (status !== 'OK' && status !== 'ZERO_RESULTS') {
      return { ok: false, code: 'provider_error', message: `Google Places 返回异常状态：${status}` }
    }

    type Candidate = { raw: NearbyApiResult; rating: number; reviews: number }
    const candidates: Candidate[] = []
    for (const raw of body?.results ?? []) {
      if (typeof raw.place_id !== 'string' || !raw.place_id) continue
      const rlat = raw.geometry?.location?.lat
      const rlng = raw.geometry?.location?.lng
      if (typeof rlat !== 'number' || typeof rlng !== 'number' || !Number.isFinite(rlat) || !Number.isFinite(rlng)) continue
      const rating = Number(raw.rating)
      const reviews = Number(raw.user_ratings_total)
      if (!Number.isFinite(rating) || !Number.isFinite(reviews)) continue
      candidates.push({ raw, rating, reviews })
    }
    const strict = candidates.filter((c) => c.rating >= 4.2 && c.reviews >= 80)
    const pool = strict.length >= 3 ? strict : candidates.filter((c) => c.rating >= 4.0 && c.reviews >= 30)
    const ranked = pool
      .sort((a, b) => b.rating * Math.log10(b.reviews + 10) - a.rating * Math.log10(a.reviews + 10))
      .slice(0, NEARBY_MAX_RESULTS)

    const fetchedAt = new Date(now()).toISOString()
    const restaurants: NearbyRestaurant[] = []
    for (const { raw, rating, reviews } of ranked) {
      const placeId = raw.place_id as string
      const photoRef = raw.photos?.find(
        (p) => typeof p.photo_reference === 'string' && isValidPhotoReference(p.photo_reference),
      )?.photo_reference
      const attribution = raw.photos?.find((p) => p.html_attributions?.length)?.html_attributions?.[0]
      const place: ResolvedPlace = {
        provider: 'google',
        placeId,
        name: raw.name ?? placeId,
        address: typeof raw.vicinity === 'string' ? raw.vicinity : null,
        lat: raw.geometry?.location?.lat as number,
        lng: raw.geometry?.location?.lng as number,
        mapsUri: mapsUriForPlaceId(placeId),
        photo: photoRef
          ? {
              photoReference: photoRef,
              displayUrl: buildPlacePhotoDisplayUrl({ photoReference: photoRef }),
              attribution: attribution ? stripHtml(attribution) : null,
            }
          : null,
        // Nearby 只回 1 张：photos 与 photo 对齐（多照片由 Place Details 补拉后回写）
        ...(photoRef ? { photos: [{ photoReference: photoRef, attribution: attribution ? stripHtml(attribution) : null }] } : {}),
        fetchedAt,
      }
      // A2：入库成功后 displayUrl 升级 placeId 寻址（与 places.ts 一致）——
      // photoReference 会过期，placeId 寻址可长期经地点库解析；入库失败保持
      // ref 形式，避免落库的 URL 永久 404。升级先于 remember/push，缓存与
      // 返回值都拿到 placeId 形式
      const stored = await upsertToStore(place)
      if (place.photo && stored) {
        place.photo.displayUrl = buildPlacePhotoDisplayUrl({ placeId })
      }
      deps.resolver?.remember(place)
      const priceLevel = Number(raw.price_level)
      restaurants.push({
        ...place,
        rating,
        userRatingsTotal: reviews,
        priceLevel: Number.isFinite(priceLevel) ? priceLevel : null,
      })
    }
    return { ok: true, restaurants }
  }
}
