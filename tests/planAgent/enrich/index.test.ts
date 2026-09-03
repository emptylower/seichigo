import { describe, it, expect, vi } from 'vitest'
import type { PlaceResolver, ResolvedPlace } from '@/lib/googlePlaces/places'
import type { NearbySearchResult } from '@/lib/googlePlaces/nearby'
import type { TravelResult } from '@/lib/directions/googleClient'
import { runEnrichers, type EnrichContext, type EnrichDay } from '@/lib/planAgent/enrich'

/**
 * M4 补齐层：每个 enricher 的正例、预算耗尽、失败静默；runEnrichers 的
 * 顺序与幂等（连跑两次 applied 第二次为 0）。
 */

const hotelPlace: ResolvedPlace = {
  provider: 'google',
  placeId: 'ChIJ_hotel',
  name: '京都酒店',
  address: '京都市',
  lat: 35.0116,
  lng: 135.7681,
  mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_hotel',
  photo: {
    photoReference: 'Aref_hotel',
    displayUrl: '/api/google/place-photo?placeId=ChIJ_hotel&maxwidth=1600',
    attribution: 'Photo by Hotel',
  },
  fetchedAt: '2026-09-02T00:00:00.000Z',
}

const ramenPlace: ResolvedPlace & { rating: number; userRatingsTotal: number; priceLevel: number } = {
  provider: 'google',
  placeId: 'ChIJ_ramen',
  name: '拉面一乐',
  address: '京都市',
  lat: 35.011,
  lng: 135.768,
  mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_ramen',
  photo: {
    photoReference: 'Aref_ramen',
    displayUrl: '/api/google/place-photo?placeId=ChIJ_ramen&maxwidth=1600',
    attribution: 'Photo by Ramen',
  },
  fetchedAt: '2026-09-02T00:00:00.000Z',
  rating: 4.6,
  userRatingsTotal: 512,
  priceLevel: 2,
}

const coords = new Map<string, { lat: number; lng: number; image?: string | null }>([
  ['p1', { lat: 34.8892, lng: 135.8075, image: '/img/p1.jpg' }],
  ['p2', { lat: 34.8963, lng: 135.8123 }],
])

const travelOk: TravelResult = {
  ok: true,
  mode: 'walking',
  legs: [],
  durationSeconds: 480,
  distanceMeters: 600,
  transfers: 0,
  walkSeconds: 480,
  transitSeconds: 0,
  polyline: [],
}

function baseCtx(over: Partial<EnrichContext> = {}): EnrichContext {
  return { deps: {}, coordsByPointId: coords, ...over }
}

function day(items: EnrichDay['items']): EnrichDay[] {
  return [{ dayIndex: 1, citySlug: null, summary: null, items }]
}

/** 模拟真实 nearby 实现：发起 Google 请求之前回调 onGoogleCall（N3 计数契约） */
function nearbyMock(result: NearbySearchResult) {
  return vi.fn(async (input: { onGoogleCall?: () => void }) => {
    input.onGoogleCall?.()
    return result
  })
}

describe('placeEnricher（包装 backfillExternalPlaces）', () => {
  it('正例：lodging 缺 place 自动解析写入 payload.place，计入 applied', async () => {
    const resolveByText = vi.fn(async () => ({ ok: true as const, place: hotelPlace, fromCache: false }))
    const places: PlaceResolver = { resolveByText, lookup: vi.fn(async () => null), remember: vi.fn() }
    const days = day([{ type: 'lodging', title: '京都酒店' }])
    const { report } = await runEnrichers(days, baseCtx({ deps: { places } }))
    expect(report.applied.place).toBe(1)
    expect((days[0].items[0].payload as Record<string, unknown>).place).toMatchObject({ placeId: 'ChIJ_hotel' })
  })

  it('预算耗尽：budget.places 已达 max 时记 skipped 不再调 Google', async () => {
    const resolveByText = vi.fn(async () => ({ ok: true as const, place: hotelPlace, fromCache: false }))
    const places: PlaceResolver = { resolveByText, lookup: vi.fn(async () => null), remember: vi.fn() }
    const days = day([{ type: 'lodging', title: '京都酒店' }])
    const { report } = await runEnrichers(
      days,
      baseCtx({ deps: { places }, budget: { directions: { used: 0, max: 8 }, places: { used: 6, max: 6 }, windowStartedAt: Date.now() } }),
    )
    expect(report.applied.place).toBe(0)
    expect(resolveByText).not.toHaveBeenCalled()
    expect(report.skipped).toContainEqual(expect.objectContaining({ enricher: 'place', reason: expect.stringContaining('预算') }))
  })

  it('A6：places.max=2、1 个 lunch 无餐厅、2 个待解析地点 → 只解析 1 个地点、餐厅补齐成功', async () => {
    // 模拟真实 resolver：发起 Google 请求之前回调 onGoogleCall（N3 计数契约）
    const resolveByText = vi.fn(async (_query: string, opts?: { onGoogleCall?: () => void }) => {
      opts?.onGoogleCall?.()
      return { ok: true as const, place: hotelPlace, fromCache: false }
    })
    const places: PlaceResolver = { resolveByText, lookup: vi.fn(async () => null), remember: vi.fn() }
    const findRestaurants = nearbyMock({ ok: true as const, restaurants: [ramenPlace] } as NearbySearchResult)
    const days = day([
      { type: 'lodging', title: '京都酒店一' },
      { type: 'lodging', title: '京都酒店二' },
      { type: 'meal', title: '午饭' },
    ])
    const { report } = await runEnrichers(
      days,
      baseCtx({
        deps: { places, findRestaurants },
        budget: { directions: { used: 0, max: 12 }, places: { used: 0, max: 2 }, windowStartedAt: Date.now() },
      }),
    )
    expect(report.applied.place).toBe(1) // 预留 1 次给餐厅 → 只解析 1 个地点
    expect(report.applied.restaurant).toBe(1)
    expect(resolveByText).toHaveBeenCalledTimes(1)
    expect(findRestaurants).toHaveBeenCalledTimes(1)
    expect(report.skipped).toContainEqual(expect.objectContaining({ enricher: 'place', reason: expect.stringContaining('预算') }))
  })

  it('R2：places.max=3、1 个 lunch、2 个待解析地点 → 餐厅一定拿到 place（lunch 不被 Text Search）', async () => {
    const resolveByText = vi.fn(async (_query: string, opts?: { onGoogleCall?: () => void }) => {
      opts?.onGoogleCall?.()
      return { ok: true as const, place: hotelPlace, fromCache: false }
    })
    const places: PlaceResolver = { resolveByText, lookup: vi.fn(async () => null), remember: vi.fn() }
    const findRestaurants = nearbyMock({ ok: true as const, restaurants: [ramenPlace] } as NearbySearchResult)
    // lunch 放最前：旧行为会先把它 Text Search 成垃圾地点；R2 起完全不参与
    const days = day([
      { type: 'meal', title: '午饭' },
      { type: 'lodging', title: '京都酒店一' },
      { type: 'lodging', title: '京都酒店二' },
    ])
    const { report } = await runEnrichers(
      days,
      baseCtx({
        deps: { places, findRestaurants },
        budget: { directions: { used: 0, max: 12 }, places: { used: 0, max: 3 }, windowStartedAt: Date.now() },
      }),
    )
    expect(resolveByText.mock.calls.map((c) => c[0])).toEqual(['京都酒店一', '京都酒店二'])
    expect(report.applied.place).toBe(2)
    expect(report.applied.restaurant).toBe(1)
    expect(findRestaurants).toHaveBeenCalledTimes(1)
    const meal = days[0].items[0]
    expect((meal?.payload as Record<string, unknown>)?.place).toMatchObject({ placeId: 'ChIJ_ramen' })
  })

  it('失败静默：places 未配置记 skipped，不抛错', async () => {
    const days = day([{ type: 'lodging', title: '京都酒店' }])
    const { report } = await runEnrichers(days, baseCtx())
    expect(report.applied.place).toBe(0)
    expect(report.skipped).toContainEqual(expect.objectContaining({ enricher: 'place', reason: '地点解析服务未配置' }))
  })
})

describe('restaurantEnricher', () => {
  function twoPointDay() {
    return day([
      { type: 'point', pointId: 'p1', title: '宇治桥' },
      { type: 'meal', title: '晚饭' },
    ])
  }

  it('正例：meal 无 place → 以前一个有坐标条目为中心搜索，取第 1 家写入并附备选', async () => {
    const findRestaurants = nearbyMock({
      ok: true as const,
      restaurants: [
        ramenPlace,
        { ...ramenPlace, placeId: 'ChIJ_sushi', name: '寿司银', rating: 4.3, userRatingsTotal: 210 },
        { ...ramenPlace, placeId: 'ChIJ_cafe', name: '咖啡店', rating: 4.1, userRatingsTotal: 90 },
      ],
    } as NearbySearchResult)
    const days = twoPointDay()
    const { report } = await runEnrichers(days, baseCtx({ deps: { findRestaurants } }))
    expect(findRestaurants).toHaveBeenCalledWith(expect.objectContaining({ lat: 34.8892, lng: 135.8075 }))
    expect(report.applied.restaurant).toBe(1)
    // meal 拿到坐标后，transport enricher 会在 p1 与 meal 之间插估算行：按类型定位
    const meal = days[0].items.find((i) => i.type === 'meal')
    expect(meal).toBeDefined()
    const payload = (meal?.payload ?? {}) as Record<string, unknown>
    expect(payload.place).toMatchObject({ placeId: 'ChIJ_ramen', photo: expect.any(Object) })
    expect(payload.place).not.toHaveProperty('rating')
    expect(meal?.note).toContain('备选：寿司银（4.3）')
  })

  it('无前置坐标 → 先取同一天后续第一个有坐标条目（meal 在当天首位的情形；A6 起非早餐才补餐厅）', async () => {
    const findRestaurants = nearbyMock({ ok: true as const, restaurants: [ramenPlace] } as NearbySearchResult)
    const days = day([{ type: 'meal', title: '午饭' }, { type: 'point', pointId: 'p1', title: '宇治桥' }])
    const { report } = await runEnrichers(days, baseCtx({ deps: { findRestaurants } }))
    expect(findRestaurants).toHaveBeenCalledWith(expect.objectContaining({ lat: 34.8892, lng: 135.8075 }))
    expect(report.applied.restaurant).toBe(1)
  })

  it('A6：breakfast 不强制推荐——mealSlot=breakfast 的 meal 条目静默跳过（不记 skipped）', async () => {
    const findRestaurants = nearbyMock({ ok: true as const, restaurants: [ramenPlace] } as NearbySearchResult)
    const days = day([{ type: 'meal', title: '早饭' }, { type: 'point', pointId: 'p1', title: '宇治桥' }])
    const { report } = await runEnrichers(days, baseCtx({ deps: { findRestaurants } }))
    expect(findRestaurants).not.toHaveBeenCalled()
    expect(report.applied.restaurant).toBe(0)
    expect(report.skipped.filter((s) => s.enricher === 'restaurant')).toHaveLength(0)
  })

  it('当天完全无坐标 → 取前一天最后一个有坐标条目', async () => {
    const findRestaurants = nearbyMock({ ok: true as const, restaurants: [ramenPlace] } as NearbySearchResult)
    const days: EnrichDay[] = [
      { dayIndex: 1, citySlug: null, summary: null, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'point', pointId: 'p2', title: '大吉山' }] },
      { dayIndex: 2, citySlug: null, summary: null, items: [{ type: 'meal', title: '第二天晚饭' }] },
    ]
    const { report } = await runEnrichers(days, baseCtx({ deps: { findRestaurants } }))
    // 前一天最后有坐标的是 p2（大吉山）
    expect(findRestaurants).toHaveBeenCalledWith(expect.objectContaining({ lat: 34.8963, lng: 135.8123 }))
    expect(report.applied.restaurant).toBe(1)
  })

  it('当天与前一天都没有坐标 → skipped', async () => {
    const findRestaurants = nearbyMock({ ok: true as const, restaurants: [ramenPlace] } as NearbySearchResult)
    const days = day([{ type: 'meal', title: '晚饭' }])
    const { report } = await runEnrichers(days, baseCtx({ deps: { findRestaurants } }))
    expect(findRestaurants).not.toHaveBeenCalled()
    expect(report.skipped).toContainEqual(
      expect.objectContaining({ enricher: 'restaurant', reason: expect.stringContaining('坐标') }),
    )
  })

  it('预算耗尽 → skipped 不调用', async () => {
    const findRestaurants = vi.fn(async () => ({ ok: true as const, restaurants: [ramenPlace] }) as NearbySearchResult)
    const days = twoPointDay()
    const { report } = await runEnrichers(
      days,
      baseCtx({ deps: { findRestaurants }, budget: { directions: { used: 0, max: 8 }, places: { used: 6, max: 6 }, windowStartedAt: Date.now() } }),
    )
    expect(findRestaurants).not.toHaveBeenCalled()
    expect(report.skipped).toContainEqual(expect.objectContaining({ enricher: 'restaurant', reason: expect.stringContaining('预算') }))
  })

  it('失败静默：无结果记 skipped，条目保持原样（A3 后可借到邻近图，但 place 不落）', async () => {
    const findRestaurants = nearbyMock({ ok: true as const, restaurants: [] } as NearbySearchResult)
    const days = twoPointDay()
    const { report } = await runEnrichers(days, baseCtx({ deps: { findRestaurants } }))
    expect(report.applied.restaurant).toBe(0)
    expect((days[0].items[1].payload as Record<string, unknown> | null)?.place ?? null).toBeNull()
    expect(report.skipped).toContainEqual(expect.objectContaining({ enricher: 'restaurant', reason: expect.stringContaining('没有找到') }))
  })

  it('幂等：已有合法 place 的 meal 不重复处理', async () => {
    const findRestaurants = vi.fn(async () => ({ ok: true as const, restaurants: [ramenPlace] }) as NearbySearchResult)
    const days = day([{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'meal', title: '晚饭', payload: { place: ramenPlace } }])
    const { report } = await runEnrichers(days, baseCtx({ deps: { findRestaurants } }))
    expect(findRestaurants).not.toHaveBeenCalled()
    expect(report.applied.restaurant).toBe(0)
  })

  it('备选为空时不留尾部「；」：note 保持 null / 原值不被追加', async () => {
    // 只返回 1 家（无备选）
    const findRestaurants = vi.fn(async () => ({ ok: true as const, restaurants: [ramenPlace] }) as NearbySearchResult)
    const days = day([
      { type: 'point', pointId: 'p1', title: '宇治桥' },
      { type: 'meal', title: '晚饭' },
      { type: 'meal', title: '午饭', note: '想吃拉面' },
    ])
    await runEnrichers(days, baseCtx({ deps: { findRestaurants } }))
    // transport enricher 会在坐标条目间插估算行：按标题定位断言
    const dinner = days[0].items.find((i) => i.title === '晚饭')
    const lunch = days[0].items.find((i) => i.title === '午饭')
    expect(dinner?.note ?? null).toBeNull()
    expect(lunch?.note).toBe('想吃拉面')
  })
})

describe('transportEnricher', () => {
  it('正例：相邻有坐标条目缺 transit → 按偏好插入 transit 行（payload.transport 带 provider）', async () => {
    const travel = vi.fn(async () => travelOk)
    const days = day([{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'point', pointId: 'p2', title: '大吉山' }])
    const { report } = await runEnrichers(days, baseCtx({ deps: { travel } }))
    expect(report.applied.transport).toBe(1)
    expect(travel).toHaveBeenCalledWith(expect.objectContaining({ origin: { lat: 34.8892, lng: 135.8075 }, destination: { lat: 34.8963, lng: 135.8123 }, mode: 'walking' }))
    expect(days[0].items).toHaveLength(3)
    const inserted = days[0].items[1]
    expect(inserted.type).toBe('transit')
    expect(inserted.title).toBe('宇治桥 → 大吉山')
    expect((inserted.payload as Record<string, unknown>).transport).toMatchObject({ provider: 'google', mode: 'walk' })
  })

  it('travelMode=mixed 缺省策略：直线 >1.5km 用 transit 查询', async () => {
    const farCoords = new Map(coords)
    farCoords.set('p2', { lat: 34.9858, lng: 135.7585 })
    const travel = vi.fn(async () => ({ ...travelOk, mode: 'transit' }) as TravelResult)
    const days = day([{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'point', pointId: 'p2', title: '京都站' }])
    await runEnrichers(days, baseCtx({ deps: { travel }, coordsByPointId: farCoords }))
    expect(travel).toHaveBeenCalledWith(expect.objectContaining({ mode: 'transit' }))
  })

  it('travelMode=driving 显式覆盖 mixed 策略', async () => {
    const travel = vi.fn(async () => travelOk)
    const days = day([{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'point', pointId: 'p2', title: '大吉山' }])
    await runEnrichers(days, baseCtx({ deps: { travel }, travelMode: 'driving' }))
    expect(travel).toHaveBeenCalledWith(expect.objectContaining({ mode: 'driving' }))
  })

  it('相邻两坐标条目之间存在任一 transit 行 → 不在旁边插第二行（N1 幂等）；A4：provider 空的行就地补齐', async () => {
    const travel = vi.fn(async () => travelOk)
    const days = day([
      { type: 'point', pointId: 'p1', title: '宇治桥' },
      { type: 'transit', title: '步行前往大吉山', payload: { transport: { mode: 'walk', durationMin: 8, provider: 'google' } } },
      { type: 'point', pointId: 'p2', title: '大吉山' },
      // provider 为空的不合格行：A4 起就地补齐（不再留缺口），仍不插第二行
      { type: 'transit', title: '无 provider 交通', payload: { transport: { mode: 'walk', durationMin: 8 } } },
      { type: 'point', pointId: 'p1', title: '回程再看一眼' },
    ])
    const { report } = await runEnrichers(days, baseCtx({ deps: { travel } }))
    // 只有 provider 空的那一段被真实查询并就地补齐
    expect(travel).toHaveBeenCalledTimes(1)
    expect(travel).toHaveBeenCalledWith(expect.objectContaining({ destination: { lat: 34.8892, lng: 135.8075 } }))
    expect(report.applied.transport).toBe(1)
    expect(days[0].items).toHaveLength(5)
    expect((days[0].items[3].payload as Record<string, unknown>).transport).toMatchObject({ provider: 'google' })
  })

  it('预算耗尽（A5）→ 零外呼估算兜底：插入 provider estimate + source heuristic 的 transit 行', async () => {
    const travel = vi.fn(async () => travelOk)
    const days = day([{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'point', pointId: 'p2', title: '大吉山' }])
    const { report } = await runEnrichers(
      days,
      baseCtx({ deps: { travel }, budget: { directions: { used: 8, max: 8 }, places: { used: 6, max: 6 }, windowStartedAt: Date.now() } }),
    )
    expect(travel).not.toHaveBeenCalled()
    expect(report.applied.transport).toBe(1)
    expect(report.skipped.filter((s) => s.enricher === 'transport')).toHaveLength(0)
    expect((days[0].items[1].payload as Record<string, unknown>).transport).toMatchObject({
      provider: 'estimate',
      source: 'heuristic',
      estimated: true,
    })
  })

  it('查询失败（A5 zero_results）→ 同样写估算行，不再只记 skipped', async () => {
    const travel = vi.fn(async () => ({ ok: false, code: 'zero_results', message: '无路线' }) as TravelResult)
    const days = day([{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'point', pointId: 'p2', title: '大吉山' }])
    const { report } = await runEnrichers(days, baseCtx({ deps: { travel } }))
    expect(report.applied.transport).toBe(1)
    expect(days[0].items).toHaveLength(3)
    expect((days[0].items[1].payload as Record<string, unknown>).transport).toMatchObject({ provider: 'estimate', source: 'heuristic' })
  })

  it('无 travel 服务（A5）→ 零外呼估算补齐缺口，不再静默留空', async () => {
    const days = day([{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'point', pointId: 'p2', title: '大吉山' }])
    const { report } = await runEnrichers(days, baseCtx())
    expect(report.applied.transport).toBe(1)
    expect((days[0].items[1].payload as Record<string, unknown>).transport).toMatchObject({ provider: 'estimate', source: 'heuristic' })
    expect(report.skipped.filter((s) => s.enricher === 'transport')).toHaveLength(0)
  })
})

describe('mediaEnricher', () => {
  it('正例：有 place（安全 photo）无 media → 派生 payload.media', async () => {
    const days = day([{ type: 'lodging', title: '京都酒店', payload: { place: hotelPlace } }])
    const { report } = await runEnrichers(days, baseCtx())
    expect(report.applied.media).toBe(1)
    expect((days[0].items[0].payload as Record<string, unknown>).media).toMatchObject({ displayUrl: '/api/google/place-photo?placeId=ChIJ_hotel&maxwidth=1600' })
  })

  it('place.photo 不安全（外部 URL）→ 不注入，静默无图', async () => {
    const unsafe = { ...hotelPlace, photo: { ...hotelPlace.photo!, displayUrl: 'https://evil.com/x.jpg' } }
    const days = day([{ type: 'lodging', title: '京都酒店', payload: { place: unsafe } }])
    const { report } = await runEnrichers(days, baseCtx())
    expect(report.applied.media).toBe(0)
    expect((days[0].items[0].payload as Record<string, unknown>).media).toBeUndefined()
  })

  it('已有 media → 不覆盖（幂等）', async () => {
    const existing = { displayUrl: '/api/google/place-photo?placeId=ChIJ_hotel&maxwidth=800' }
    const days = day([{ type: 'lodging', title: '京都酒店', payload: { place: hotelPlace, media: existing } }])
    const { report } = await runEnrichers(days, baseCtx())
    expect(report.applied.media).toBe(0)
    expect((days[0].items[0].payload as Record<string, unknown>).media).toEqual(existing)
  })

  it('A2：place 只剩 placeId/name/lat/lng（模型裁剪照抄）→ 地点库回填 photo 后派生 media', async () => {
    const { createMemoryExternalPlaceStore } = await import('@/lib/googlePlaces/storeMemory')
    const store = createMemoryExternalPlaceStore()
    await store.upsert(hotelPlace, null)
    const clipped = {
      provider: 'google',
      placeId: 'ChIJ_hotel',
      name: '京都酒店',
      lat: 35.0116,
      lng: 135.7681,
      mapsUri: hotelPlace.mapsUri,
      photo: null,
      fetchedAt: hotelPlace.fetchedAt,
    }
    const days = day([{ type: 'meal', title: '晚饭', payload: { place: clipped } }])
    const { report } = await runEnrichers(days, baseCtx({ deps: { externalPlaces: store } }))
    expect(report.applied.media).toBe(1)
    const payload = days[0].items[0].payload as Record<string, unknown>
    // place.photo 已回填（placeId 寻址），media 派生成功
    expect((payload.place as Record<string, unknown>).photo).toMatchObject({
      photoReference: 'Aref_hotel',
      displayUrl: '/api/google/place-photo?placeId=ChIJ_hotel&maxwidth=1600',
    })
    expect(payload.media).toMatchObject({ displayUrl: '/api/google/place-photo?placeId=ChIJ_hotel&maxwidth=1600' })
  })

  it('A2：地点库也没有 photoReference（或库未注入）→ 跳过，不注入 media', async () => {
    const clipped = {
      provider: 'google',
      placeId: 'ChIJ_nophoto',
      name: '无图地点',
      lat: 35.01,
      lng: 135.76,
      photo: null,
    }
    const noStoreDays = day([{ type: 'meal', title: '晚饭', payload: { place: { ...clipped } } }])
    const { report } = await runEnrichers(noStoreDays, baseCtx())
    expect(report.applied.media).toBe(0)
    expect((noStoreDays[0].items[0].payload as Record<string, unknown>).media).toBeUndefined()

    const { createMemoryExternalPlaceStore } = await import('@/lib/googlePlaces/storeMemory')
    const store = createMemoryExternalPlaceStore()
    await store.upsert({ ...hotelPlace, placeId: 'ChIJ_nophoto', photo: null }, null)
    const storeDays = day([{ type: 'meal', title: '晚饭', payload: { place: { ...clipped } } }])
    const { report: report2 } = await runEnrichers(storeDays, baseCtx({ deps: { externalPlaces: store } }))
    expect(report2.applied.media).toBe(0)
    expect((storeDays[0].items[0].payload as Record<string, unknown>).media).toBeUndefined()
  })
})

describe('neighborImageEnricher（A3 邻近图兜底）', () => {
  it('自由安排条目取同一天前一个有图条目的站内图，attribution 记来源标题', async () => {
    const days = day([
      { type: 'point', pointId: 'p1', title: '宇治桥' },
      { type: 'free', title: '自由安排' },
    ])
    const { report } = await runEnrichers(days, baseCtx())
    expect(report.applied.neighbor).toBe(1)
    const media = (days[0].items[1].payload as Record<string, unknown>).media as Record<string, unknown>
    expect(media).toMatchObject({ source: 'neighbor', displayUrl: '/img/p1.jpg', attribution: '宇治桥' })
  })

  it('前一个条目有 payload.media（place 派生图）时同样可作来源', async () => {
    const days = day([
      { type: 'lodging', title: '京都酒店', payload: { place: hotelPlace, media: { source: 'google_places', displayUrl: '/api/google/place-photo?placeId=ChIJ_hotel&maxwidth=1600' } } },
      { type: 'free', title: '心斋桥一带' },
    ])
    const { report } = await runEnrichers(days, baseCtx())
    expect(report.applied.neighbor).toBe(1)
    expect((days[0].items[1].payload as Record<string, unknown>).media).toMatchObject({
      source: 'neighbor',
      displayUrl: '/api/google/place-photo?placeId=ChIJ_hotel&maxwidth=1600',
      attribution: '京都酒店',
    })
  })

  it('前面没有有图条目 → 取同一天后续第一个有图条目', async () => {
    const days = day([
      { type: 'free', title: '自由安排' },
      { type: 'point', pointId: 'p1', title: '宇治桥' },
    ])
    await runEnrichers(days, baseCtx())
    expect((days[0].items[0].payload as Record<string, unknown>).media).toMatchObject({ source: 'neighbor', displayUrl: '/img/p1.jpg' })
  })

  it('当天整日无图 → 取前一天最后一个有图条目（链式借用：无图点位先借到图，成为后一天的来源）', async () => {
    const days: EnrichDay[] = [
      { dayIndex: 1, citySlug: null, summary: null, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'point', pointId: 'p2', title: '大吉山' }] },
      { dayIndex: 2, citySlug: null, summary: null, items: [{ type: 'free', title: '自由安排' }] },
    ]
    await runEnrichers(days, baseCtx())
    // p2 自身无站内图：先从前一个 p1 借到图（attribution 宇治桥）；随后 day2 的
    // free 在前一天从后往前找到的第一个有图条目是已借到图的 p2。
    // 注意 transport enricher 会在 p1/p2 之间插估算行：p2 在 day1 的 index 2
    const day2Media = (days[1].items[0].payload as Record<string, unknown>).media as Record<string, unknown>
    expect(day2Media).toMatchObject({ source: 'neighbor', displayUrl: '/img/p1.jpg', attribution: '大吉山' })
    const p2Media = (days[0].items[2].payload as Record<string, unknown>).media as Record<string, unknown>
    expect(p2Media).toMatchObject({ source: 'neighbor', displayUrl: '/img/p1.jpg', attribution: '宇治桥' })
  })

  it('全计划无图 → 跳过不写 media；transit 不处理', async () => {
    const bareCoords = new Map<string, { lat: number; lng: number; image?: string | null }>([['p1', { lat: 34.8892, lng: 135.8075 }]])
    const days = day([
      { type: 'free', title: '自由安排' },
      { type: 'point', pointId: 'p1', title: '无图点位' },
      { type: 'transit', title: '交通行' },
    ])
    const { report } = await runEnrichers(days, baseCtx({ coordsByPointId: bareCoords }))
    expect(report.applied.neighbor).toBe(0)
    expect(days[0].items[0].payload ?? null).toBeNull()
    expect(days[0].items[1].payload ?? null).toBeNull()
    expect(days[0].items[2].payload ?? null).toBeNull()
  })

  it('已有自身图的条目不被覆盖：站内 image 的点位不写 payload.media，已有 media 的条目保持原值', async () => {
    const existingMedia = { source: 'google_places', displayUrl: '/api/google/place-photo?placeId=ChIJ_hotel&maxwidth=1600' }
    const days = day([
      { type: 'point', pointId: 'p1', title: '宇治桥' },
      { type: 'lodging', title: '自带 media 的酒店', payload: { media: existingMedia } },
      { type: 'free', title: '自由安排' },
    ])
    await runEnrichers(days, baseCtx())
    expect(days[0].items[0].payload ?? null).toBeNull()
    expect((days[0].items[1].payload as Record<string, unknown>).media).toEqual(existingMedia)
    expect((days[0].items[2].payload as Record<string, unknown>).media).toMatchObject({ source: 'neighbor' })
  })

  it('幂等：已有 neighbor media 的条目第二次运行 applied.neighbor 为 0', async () => {
    const days = day([{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'free', title: '自由安排' }])
    await runEnrichers(days, baseCtx())
    const second = await runEnrichers(days, baseCtx())
    expect(second.report.applied.neighbor).toBe(0)
  })
})

describe('runEnrichers 顺序与幂等', () => {
  it('顺序：place 解析先于 media 派生（同一次运行内新解析的地点也能拿到图）', async () => {
    const places: PlaceResolver = {
      resolveByText: vi.fn(async () => ({ ok: true as const, place: hotelPlace, fromCache: false })),
      lookup: vi.fn(async () => null),
      remember: vi.fn(),
    }
    const days = day([{ type: 'lodging', title: '京都酒店' }])
    const { report } = await runEnrichers(days, baseCtx({ deps: { places } }))
    expect(report.applied.place).toBe(1)
    expect(report.applied.media).toBe(1)
  })

  it('幂等：同一份 days 连跑两次，第二次全部 applied 为 0', async () => {
    const places: PlaceResolver = {
      // place 兜底解析失败（如标题不是地点名），才会走到餐厅 enricher
      resolveByText: vi.fn(async () => ({ ok: false as const, code: 'not_found' as const, message: '未找到' })),
      lookup: vi.fn(async () => null),
      remember: vi.fn(),
    }
    const travel = vi.fn(async () => travelOk)
    const findRestaurants = vi.fn(async () => ({ ok: true as const, restaurants: [ramenPlace] }) as NearbySearchResult)
    const days = day([
      { type: 'point', pointId: 'p1', title: '宇治桥' },
      { type: 'meal', title: '晚饭' },
    ])
    const ctx = baseCtx({ deps: { places, travel, findRestaurants } })
    const first = await runEnrichers(days, ctx)
    expect(first.report.applied).toMatchObject({ place: 0, restaurant: 1, transport: 1, media: 1 })

    const second = await runEnrichers(days, ctx)
    expect(second.report.applied).toEqual({ meal: 0, place: 0, restaurant: 0, transport: 0, schedule: 0, media: 0, dedupe: 0, neighbor: 0 })
  })

  it('预算按 provider 分桶：places 与 directions 互不挤占，各自限量', async () => {
    const travel = vi.fn(async () => travelOk)
    const findRestaurants = nearbyMock({ ok: true as const, restaurants: [ramenPlace] } as NearbySearchResult)
    const places: PlaceResolver = {
      // 让 place 兜底不打 Google（失败静默），预算全部留给餐厅/交通
      resolveByText: vi.fn(async () => ({ ok: false as const, code: 'not_found' as const, message: '未找到' })),
      lookup: vi.fn(async () => null),
      remember: vi.fn(),
    }
    const days = day([
      { type: 'point', pointId: 'p1', title: '宇治桥' },
      { type: 'meal', title: '晚饭' },
      { type: 'point', pointId: 'p2', title: '大吉山' },
    ])
    const { report } = await runEnrichers(
      days,
      baseCtx({ deps: { places, travel, findRestaurants }, budget: { directions: { used: 0, max: 0 }, places: { used: 0, max: 1 }, windowStartedAt: Date.now() } }),
    )
    // restaurant 用掉唯一 1 次 places 预算；meal 拿到坐标后 p1→meal、meal→p2
    // 两段缺口在 directions 预算为 0 时都走零外呼估算兜底（A5）：不外呼
    // travel，但各插入一行 heuristic 估算
    expect(report.applied.restaurant).toBe(1)
    expect(report.applied.transport).toBe(2)
    expect(travel).not.toHaveBeenCalled()
    expect(report.googleCallsUsed).toEqual({ directions: 0, places: 1 })
    expect((days[0].items[3].payload as Record<string, unknown>).transport).toMatchObject({ provider: 'estimate', source: 'heuristic' })
  })
})
