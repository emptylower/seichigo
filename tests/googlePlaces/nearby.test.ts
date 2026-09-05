import { describe, it, expect, vi } from 'vitest'
import { createNearbySearch } from '@/lib/googlePlaces/nearby'
import { createPlaceResolver, createPlacesRateWindow } from '@/lib/googlePlaces/places'
import { createMemoryExternalPlaceStore } from '@/lib/googlePlaces/storeMemory'

/**
 * A3 餐厅推荐：Places Nearby Search（type=restaurant）封装。
 * 筛选 rating ≥ 4.2 且评价数 ≥ 80；不足 3 家放宽到 ≥ 4.0 且 ≥ 30；
 * 按 rating × log10(评价数 + 10) 降序取前 5；upsert 入库并写入 resolver 内存缓存。
 */

const center = { lat: 35.6938, lng: 139.7034 }

function nearbyResult(placeId: string, rating: number, reviews: number, extra: Record<string, unknown> = {}) {
  return {
    place_id: placeId,
    name: `餐厅 ${placeId}`,
    vicinity: '東京都新宿区',
    geometry: { location: { lat: 35.695, lng: 139.705 } },
    rating,
    user_ratings_total: reviews,
    ...extra,
  }
}

function nearbyBody(results: Array<Record<string, unknown>>, status = 'OK') {
  return { ok: true, json: async () => ({ status, results }) } as unknown as Response
}

describe('createNearbySearch', () => {
  it('严格筛选满足 3 家时不放宽：4.6/512、4.3/120、4.25/100 入选，4.1/60 与 3.8/400 落选', async () => {
    const fetchImpl = vi.fn(async () =>
      nearbyBody([
        nearbyResult('ChIJ_a', 4.6, 512, { price_level: 2, photos: [{ photo_reference: 'Aref_a_1234567890', html_attributions: ['<a href="#">Photo by A</a>'] }] }),
        nearbyResult('ChIJ_b', 4.3, 120),
        nearbyResult('ChIJ_b2', 4.25, 100),
        nearbyResult('ChIJ_c', 4.1, 60),
        nearbyResult('ChIJ_d', 3.8, 400),
      ]),
    )
    const nearby = createNearbySearch({ apiKey: 'k', fetchImpl, rateKey: 'nearby-1' })
    const result = await nearby(center)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 严格档已有 3 家 → 不放宽，4.1/60 与 3.8/400 落选；按评分×log 排序
    expect(result.restaurants.map((r) => r.placeId)).toEqual(['ChIJ_a', 'ChIJ_b', 'ChIJ_b2'])
    // 排序：4.6×log10(522) ≈ 12.5 > 4.3×log10(130) ≈ 9.0
    const [first] = result.restaurants
    expect(first).toMatchObject({
      provider: 'google',
      placeId: 'ChIJ_a',
      name: '餐厅 ChIJ_a',
      address: '東京都新宿区',
      lat: 35.695,
      lng: 139.705,
      rating: 4.6,
      userRatingsTotal: 512,
      priceLevel: 2,
    })
    expect(first.mapsUri).toBe('https://www.google.com/maps/place/?q=place_id:ChIJ_a')
    expect(first.photo).toMatchObject({
      photoReference: 'Aref_a_1234567890',
      displayUrl: '/api/google/place-photo?ref=Aref_a_1234567890&maxwidth=1600',
      attribution: 'Photo by A',
    })
    expect(JSON.stringify(result)).not.toContain('key=k')
  })

  it('严格筛选不足 3 家时放宽到 ≥4.0 且 ≥30：4.1/60 补位，3.8/400 与 4.8/25 仍落选', async () => {
    const fetchImpl = vi.fn(async () =>
      nearbyBody([
        nearbyResult('ChIJ_a', 4.6, 512),
        nearbyResult('ChIJ_b', 4.3, 120),
        nearbyResult('ChIJ_c', 4.1, 60),
        nearbyResult('ChIJ_d', 3.8, 400),
        nearbyResult('ChIJ_e', 4.8, 25),
      ]),
    )
    const nearby = createNearbySearch({ apiKey: 'k', fetchImpl, rateKey: 'nearby-2' })
    const result = await nearby(center)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.restaurants.map((r) => r.placeId).sort()).toEqual(['ChIJ_a', 'ChIJ_b', 'ChIJ_c'])
  })

  it('按 rating × log10(评价数+10) 降序且最多 5 家（7 家合格只回前 5）', async () => {
    const fetchImpl = vi.fn(async () =>
      nearbyBody([
        nearbyResult('ChIJ_low_score', 4.3, 90), // 4.3×log10(100)=8.6
        nearbyResult('ChIJ_top', 4.7, 900), // 4.7×log10(910)≈13.9
        nearbyResult('ChIJ_m2', 4.5, 300),
        nearbyResult('ChIJ_m3', 4.4, 200),
        nearbyResult('ChIJ_m4', 4.4, 150),
        nearbyResult('ChIJ_m5', 4.2, 100),
        nearbyResult('ChIJ_m6', 4.2, 95),
      ]),
    )
    const nearby = createNearbySearch({ apiKey: 'k', fetchImpl, rateKey: 'nearby-3' })
    const result = await nearby(center)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.restaurants).toHaveLength(5)
    expect(result.restaurants[0].placeId).toBe('ChIJ_top')
    expect(result.restaurants.map((r) => r.rating * Math.log10(r.userRatingsTotal + 10))).toEqual(
      [...result.restaurants.map((r) => r.rating * Math.log10(r.userRatingsTotal + 10))].sort((a, b) => b - a),
    )
    expect(result.restaurants.map((r) => r.placeId)).not.toContain('ChIJ_m6')
  })

  it('upsert 入库（null 查询键）+ 写入 resolver 内存缓存（出处校验能命中）', async () => {
    const store = createMemoryExternalPlaceStore()
    const fetchImpl = vi.fn(async () => nearbyBody([nearbyResult('ChIJ_a', 4.6, 512)]))
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, rateKey: 'nearby-4' })
    const nearby = createNearbySearch({ apiKey: 'k', fetchImpl, rateKey: 'nearby-4', store, resolver })
    const result = await nearby(center)
    expect(result.ok).toBe(true)
    expect(await store.findByPlaceId('google', 'ChIJ_a')).toMatchObject({ placeId: 'ChIJ_a', provider: 'google' })
    expect(await resolver.lookup('ChIJ_a')).toMatchObject({ placeId: 'ChIJ_a', provider: 'google' })
  })

  it('A2：store.upsert 成功后 displayUrl 升级 placeId 寻址（与 places.ts 一致）；无 store 保持 ref 形式', async () => {
    // 无 store（或库不可用）：保持 photoReference 寻址，避免落库 URL 永久 404
    const noStore = createNearbySearch({
      apiKey: 'k',
      fetchImpl: vi.fn(async () =>
        nearbyBody([nearbyResult('ChIJ_pid', 4.6, 512, { photos: [{ photo_reference: 'Aref_pid_1234567890' }] })]),
      ),
      rateKey: 'nearby-pid-1',
    })
    const refResult = await noStore(center)
    expect(refResult.ok && refResult.restaurants[0].photo?.displayUrl).toBe(
      '/api/google/place-photo?ref=Aref_pid_1234567890&maxwidth=1600',
    )

    // 入库成功：升级 placeId 寻址（photoReference 会过期，placeId 长期可解析）
    const store = createMemoryExternalPlaceStore()
    const stored = createNearbySearch({
      apiKey: 'k',
      store,
      fetchImpl: vi.fn(async () =>
        nearbyBody([nearbyResult('ChIJ_pid', 4.6, 512, { photos: [{ photo_reference: 'Aref_pid_1234567890' }] })]),
      ),
      rateKey: 'nearby-pid-2',
    })
    const pidResult = await stored(center)
    expect(pidResult.ok && pidResult.restaurants[0].photo?.displayUrl).toBe(
      '/api/google/place-photo?placeId=ChIJ_pid&maxwidth=1600',
    )
    // resolver 缓存里也是 placeId 形式（remember 在升级之后）
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl: vi.fn(async () => nearbyBody([])), rateKey: 'nearby-pid-2' })
    const withResolver = createNearbySearch({
      apiKey: 'k',
      store,
      resolver,
      fetchImpl: vi.fn(async () =>
        nearbyBody([nearbyResult('ChIJ_pid2', 4.6, 512, { photos: [{ photo_reference: 'Aref_pid2_1234567890' }] })]),
      ),
      rateKey: 'nearby-pid-3',
    })
    await withResolver(center)
    expect((await resolver.lookup('ChIJ_pid2'))?.photo?.displayUrl).toBe(
      '/api/google/place-photo?placeId=ChIJ_pid2&maxwidth=1600',
    )
  })

  it('请求 URL：location/radius(默认 800)/type=restaurant/language=zh-CN；keyword 与 radiusM 透传', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => nearbyBody([]))
    const nearby = createNearbySearch({ apiKey: 'SECRET', fetchImpl, rateKey: 'nearby-5' })
    await nearby(center)
    await nearby({ ...center, radiusM: 1500, keyword: '拉面' })
    const firstUrl = String(fetchImpl.mock.calls[0]![0])
    // URLSearchParams 会把逗号编码为 %2C（Google 照常接受）
    expect(firstUrl).toContain('location=35.6938%2C139.7034')
    expect(firstUrl).toContain('radius=800')
    expect(firstUrl).toContain('type=restaurant')
    expect(firstUrl).toContain('language=zh-CN')
    const secondUrl = String(fetchImpl.mock.calls[1]![0])
    expect(secondUrl).toContain('radius=1500')
    expect(secondUrl).toContain('keyword=')
  })

  it('ZERO_RESULTS / 全部不合格 → ok 且空列表（由工具层转 typed 错误）', async () => {
    const zero = createNearbySearch({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => nearbyBody([], 'ZERO_RESULTS')),
      rateKey: 'nearby-6',
    })
    expect(await zero(center)).toMatchObject({ ok: true, restaurants: [] })

    const none = createNearbySearch({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => nearbyBody([nearbyResult('ChIJ_x', 3.2, 5)])),
      rateKey: 'nearby-7',
    })
    expect(await none(center)).toMatchObject({ ok: true, restaurants: [] })
  })

  it('异常状态映射：OVER_QUERY_LIMIT → rate_limited；REQUEST_DENIED → config_error', async () => {
    const limited = createNearbySearch({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => nearbyBody([], 'OVER_QUERY_LIMIT')),
      rateKey: 'nearby-8',
    })
    expect(await limited(center)).toMatchObject({ ok: false, code: 'rate_limited' })

    const denied = createNearbySearch({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => nearbyBody([], 'REQUEST_DENIED')),
      rateKey: 'nearby-9',
    })
    expect(await denied(center)).toMatchObject({ ok: false, code: 'config_error' })
  })

  it('非法坐标 → invalid_query；缺 key → config_error', async () => {
    const nearby = createNearbySearch({ apiKey: 'k', fetchImpl: vi.fn(), rateKey: 'nearby-10' })
    expect(await nearby({ lat: 999, lng: 139 })).toMatchObject({ ok: false, code: 'invalid_query' })
    const noKey = createNearbySearch({ apiKey: '', fetchImpl: vi.fn(), rateKey: 'nearby-11' })
    expect(await noKey(center)).toMatchObject({ ok: false, code: 'config_error' })
  })

  it('R2：700 字符 photo_reference 不再被丢弃——餐厅 photo 非空且 photos 恰 1 张', async () => {
    const longRef = `A${'c'.repeat(699)}`
    const fetchImpl = vi.fn(async () =>
      nearbyBody([nearbyResult('ChIJ_longref', 4.6, 512, { photos: [{ photo_reference: longRef, html_attributions: [] }] })]),
    )
    const nearby = createNearbySearch({ apiKey: 'k', fetchImpl, rateKey: 'nearby-longref' })
    const result = await nearby(center)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.restaurants).toHaveLength(1)
    const [restaurant] = result.restaurants
    expect(restaurant.photo).not.toBeNull()
    expect(restaurant.photo?.photoReference).toBe(longRef)
    expect(restaurant.photos).toHaveLength(1)
    expect(restaurant.photos?.[0]?.photoReference).toBe(longRef)
  })

  it('与 resolver 共用同一限速窗口：解析打满窗口（注入 maxCalls=8）后 nearby 不再外呼', async () => {
    const fetchImpl = vi.fn(async () => nearbyBody([nearbyResult('ChIJ_a', 4.6, 512)]))
    const rateWindow = createPlacesRateWindow({ maxCalls: 8 })
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, rateKey: 'shared', rateWindow })
    for (let i = 0; i < 8; i++) {
      expect((await resolver.resolveByText(`地点 ${i}`)).ok).toBe(true)
    }
    const nearby = createNearbySearch({ apiKey: 'k', fetchImpl, rateKey: 'shared', rateWindow })
    const result = await nearby(center)
    expect(result).toMatchObject({ ok: false, code: 'rate_limited' })
    // 8 次解析后再无任何外呼
    expect(fetchImpl).toHaveBeenCalledTimes(8)
  })

  it('N3 onGoogleCall：真实外呼前回调（错误状态同样计数）；限速拒绝/参数错误不回调', async () => {
    // Google 返回错误状态（OVER_QUERY_LIMIT）：请求真实发生 → 已计数
    let used = 0
    const onGoogleCall = () => (used += 1)
    const errorNearby = createNearbySearch({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => nearbyBody([], 'OVER_QUERY_LIMIT')),
      rateKey: 'nearby-n3-err',
    })
    const errorResult = await errorNearby({ ...center, onGoogleCall })
    expect(errorResult).toMatchObject({ ok: false, code: 'rate_limited' })
    expect(used).toBe(1)

    // 参数错误（坐标非法）：请求未发生 → 不回调
    const invalidNearby = createNearbySearch({ apiKey: 'k', fetchImpl: vi.fn(), rateKey: 'nearby-n3-invalid' })
    used = 0
    await invalidNearby({ lat: 999, lng: 139, onGoogleCall })
    expect(used).toBe(0)

    // 限速拒绝：请求未发生 → 不回调（注入 maxCalls=8 收窄窗口）
    const rateWindow = createPlacesRateWindow({ maxCalls: 8 })
    const shared = createNearbySearch({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => nearbyBody([nearbyResult('ChIJ_a', 4.6, 512)])),
      rateKey: 'nearby-n3-rl',
      rateWindow,
    })
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl: vi.fn(async () => nearbyBody([])), rateKey: 'nearby-n3-rl', rateWindow })
    for (let i = 0; i < 8; i++) await resolver.resolveByText(`地点 ${i}`)
    used = 0
    expect(await shared({ ...center, onGoogleCall })).toMatchObject({ ok: false, code: 'rate_limited' })
    expect(used).toBe(0)
  })
})
