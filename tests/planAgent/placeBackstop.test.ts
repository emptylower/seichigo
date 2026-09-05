import { describe, it, expect, vi } from 'vitest'
import { backfillExternalPlaces, dayHasBackfillCandidate } from '@/lib/planAgent/placeBackstop'
import type { PlaceResolver, ResolvedPlace } from '@/lib/googlePlaces/places'

const hotelPlace: ResolvedPlace = {
  provider: 'google',
  placeId: 'ChIJ_hotel_centro',
  name: '京都セントラルホテル',
  address: null,
  lat: 35.0116,
  lng: 135.7681,
  mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_hotel_centro',
  photo: {
    photoReference: 'Aref_hotel_1234567890',
    displayUrl: '/api/google/place-photo?placeId=ChIJ_hotel_centro&maxwidth=1600',
    attribution: null,
  },
  fetchedAt: '2026-09-02T00:00:00.000Z',
}

function makeResolver(options?: {
  place?: ResolvedPlace
  failFor?: Array<string>
}): { resolver: PlaceResolver; resolveByText: ReturnType<typeof vi.fn> } {
  const place = options?.place ?? hotelPlace
  const resolveByText = vi.fn(
    async (query: string, opts?: { near?: { lat: number; lng: number }; onGoogleCall?: () => void }) => {
      if (options?.failFor?.includes(query)) {
        // 打了 Google 才查不到（not_found）：真实外呼同样计数（N3）
        opts?.onGoogleCall?.()
        return { ok: false as const, code: 'not_found' as const, message: `Google 没有找到「${query}」对应的地点` }
      }
      // 模拟真实外呼：发起 Google 请求之前回调计数
      opts?.onGoogleCall?.()
      return { ok: true as const, place, fromCache: false, near: opts?.near }
    },
  )
  const lookedUp = new Map<string, ResolvedPlace>([[place.placeId, place]])
  return {
    resolveByText,
    resolver: {
      resolveByText,
      lookup: vi.fn(async (placeId: string) => lookedUp.get(placeId) ?? null),
      remember: vi.fn(),
    },
  }
}

function item(fields: Record<string, unknown>) {
  return { type: 'free', title: '', ...fields } as Parameters<typeof backfillExternalPlaces>[0]['days'][number]['items'][number]
}

describe('backfillExternalPlaces（save_plan_days 保存时兜底）', () => {
  it('lodging/meal/attraction 与无 pointId 的 point 会被解析并写入 payload.place；剥不出地名的 free 与带 pointId 的不动', async () => {
    const { resolver } = makeResolver()
    const days = [
      {
        dayIndex: 1,
        items: [
          item({ type: 'lodging', title: '京都セントラルホテル', payload: null }),
          item({ type: 'meal', title: 'ラーメン店', payload: null }),
          item({ type: 'attraction', title: '清水寺', payload: null }),
          item({ type: 'point', title: '外部景点（无 pointId）', payload: null }),
          item({ type: 'free', title: '自由时间', payload: null }),
          item({ type: 'point', pointId: 'p1', title: '站内点位', payload: null }),
          item({ type: 'point', title: '已有合法地点', payload: { place: { provider: 'google', placeId: 'ChIJ_x', name: 'X', lat: 1, lng: 2 } } }),
        ],
      },
    ]
    const result = await backfillExternalPlaces({ days, places: resolver, dayCoordinates: () => [] })
    expect(result.resolved).toBe(4)
    expect(days[0].items[0].payload?.place).toMatchObject({ placeId: 'ChIJ_hotel_centro' })
    expect(days[0].items[3].payload?.place).toMatchObject({ placeId: 'ChIJ_hotel_centro' })
    expect(days[0].items[4].payload ?? null).toBeNull()
    expect(days[0].items[5].payload ?? null).toBeNull()
    expect((days[0].items[6].payload as Record<string, unknown>).place).toMatchObject({ placeId: 'ChIJ_x' })
  })

  it('A1：free 参考类条目也解析——剥修饰词后取地名写入 payload.place', async () => {
    const { resolver, resolveByText } = makeResolver()
    const days = [
      {
        dayIndex: 1,
        items: [
          item({ type: 'free', title: '泊宿参考：难波', payload: null }),
          item({ type: 'free', title: '心斋桥一带', payload: null }),
          item({ type: 'free', title: '京都站到关西机场', payload: null }),
        ],
      },
    ]
    const result = await backfillExternalPlaces({ days, places: resolver, dayCoordinates: () => [] })
    expect(result.resolved).toBe(3)
    expect(resolveByText.mock.calls.map((c) => c[0])).toEqual(['难波', '心斋桥', '关西机场'])
    expect(days[0].items[0].payload?.place).toMatchObject({ placeId: 'ChIJ_hotel_centro' })
    expect(days[0].items[2].payload?.place).toMatchObject({ placeId: 'ChIJ_hotel_centro' })
  })

  it('A1：free 的 payload.placeQuery 优先于标题', async () => {
    const { resolver, resolveByText } = makeResolver()
    const days = [
      {
        dayIndex: 1,
        items: [item({ type: 'free', title: '泊宿参考', payload: { placeQuery: 'なんば駅' } })],
      },
    ]
    const result = await backfillExternalPlaces({ days, places: resolver, dayCoordinates: () => [] })
    expect(result.resolved).toBe(1)
    expect(resolveByText).toHaveBeenCalledWith('なんば駅', expect.anything())
  })

  it('剥完为空才跳过：自由时间/机动/休息 与过短查询词跳过；「返程准备」不再整词拦截（会照常解析）', async () => {
    const { resolver } = makeResolver()
    const days = [
      {
        dayIndex: 1,
        items: [
          item({ type: 'free', title: '自由时间' }),
          item({ type: 'lodging', title: '机动' }),
          item({ type: 'meal', title: '休息' }),
          item({ type: 'lodging', title: '酒' }), // 剥完后长度 1
          item({ type: 'lodging', title: '  ' }),
          item({ type: 'free', title: '返程准备' }),
        ],
      },
    ]
    const result = await backfillExternalPlaces({ days, places: resolver, dayCoordinates: () => [] })
    expect(result.resolved).toBe(1)
    expect(days[0].items[5].payload?.place).toMatchObject({ placeId: 'ChIJ_hotel_centro' })
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: '自由时间' }),
        expect.objectContaining({ title: '机动' }),
        expect.objectContaining({ title: '酒' }),
      ]),
    )
  })

  it('模糊词整词匹配：自由が丘 会解析，自由时间/自由活动/自由漫步 会被跳过', async () => {
    const { resolver } = makeResolver()
    const days = [
      {
        dayIndex: 1,
        items: [
          item({ type: 'lodging', title: '自由が丘' }),
          item({ type: 'meal', title: '自由时间' }),
          item({ type: 'meal', title: '自由活动' }),
          item({ type: 'attraction', title: '自由漫步' }),
        ],
      },
    ]
    const result = await backfillExternalPlaces({ days, places: resolver, dayCoordinates: () => [] })
    expect(result.resolved).toBe(1)
    expect(days[0].items[0].payload?.place).toMatchObject({ placeId: 'ChIJ_hotel_centro' })
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: '自由时间' }),
        expect.objectContaining({ title: '自由活动' }),
        expect.objectContaining({ title: '自由漫步' }),
      ]),
    )
  })

  it('resolveByText 抛错时 skipped 用固定文案，不把 err.message 暴露给模型', async () => {
    const throwing: PlaceResolver = {
      resolveByText: async () => {
        throw new Error('secret upstream failure detail')
      },
      lookup: vi.fn(async () => null),
      remember: vi.fn(),
    }
    const days = [{ dayIndex: 1, items: [item({ type: 'lodging', title: '某酒店' })] }]
    const result = await backfillExternalPlaces({ days, places: throwing, dayCoordinates: () => [] })
    expect(result.resolved).toBe(0)
    expect(result.skipped).toEqual([{ title: '某酒店', reason: '地点解析服务异常' }])
    expect(JSON.stringify(result.skipped)).not.toContain('secret upstream failure detail')
  })

  it('传给 resolveByText 的是 trim 后的原始查询词（归一化只用于长度/模糊词判断）', async () => {
    const { resolver, resolveByText } = makeResolver()
    const days = [
      {
        dayIndex: 1,
        items: [
          item({
            type: 'lodging',
            title: '第一晚住宿',
            payload: { placeQuery: '  ＮＥＷ ＣｈｉｔｓｅＯ空港  ' },
          }),
        ],
      },
    ]
    const result = await backfillExternalPlaces({ days, places: resolver, dayCoordinates: () => [] })
    expect(result.resolved).toBe(1)
    expect(resolveByText).toHaveBeenCalledTimes(1)
    expect(resolveByText.mock.calls[0]![0]).toBe('ＮＥＷ ＣｈｉｔｓｅＯ空港')
  })

  it('结果距当天质心 > 50km 拒绝并记录 skipped', async () => {
    const farPlace: ResolvedPlace = { ...hotelPlace, placeId: 'ChIJ_far', lat: 35.8, lng: 137.0 }
    const { resolver } = makeResolver({ place: farPlace })
    const days = [{ dayIndex: 1, items: [item({ type: 'lodging', title: '名古屋酒店' })] }]
    const result = await backfillExternalPlaces({
      days,
      places: resolver,
      dayCoordinates: () => [{ lat: 35.01, lng: 135.76 }],
    })
    expect(result.resolved).toBe(0)
    expect(result.skipped).toContainEqual(expect.objectContaining({ title: '名古屋酒店', reason: expect.stringContaining('过远') }))
    expect(days[0].items[0].payload ?? null).toBeNull()
  })

  it('Google 调用预算 6 次：库命中不计入（不回调 onGoogleCall），第 7 次未命中的跳过', async () => {
    const { resolver } = makeResolver()
    const items = Array.from({ length: 8 }, (_, i) => item({ type: 'meal', title: `餐厅${i}号店` }))
    const days = [{ dayIndex: 1, items }]
    const result = await backfillExternalPlaces({ days, places: resolver, dayCoordinates: () => [] })
    expect(result.resolved).toBe(6)
    expect(resolver.resolveByText).toHaveBeenCalledTimes(6)
    expect(result.skipped).toContainEqual(expect.objectContaining({ title: '餐厅6号店', reason: expect.stringContaining('预算') }))

    // fromCache=true（库命中）不发起真实外呼 → 不回调 onGoogleCall，不消耗
    // 预算：8 个候选全部补齐
    const cachedResolve = vi.fn(async (_query: string, opts?: { onGoogleCall?: () => void }) => {
      // 库命中路径：绝不回调 onGoogleCall
      expect(opts?.onGoogleCall).toBeTypeOf('function')
      return { ok: true as const, place: { ...hotelPlace }, fromCache: true }
    })
    const cachedResolver: PlaceResolver = { resolveByText: cachedResolve, lookup: vi.fn(async () => null), remember: vi.fn() }
    const days2 = [{ dayIndex: 1, items: Array.from({ length: 8 }, (_, i) => item({ type: 'meal', title: `餐厅${i}号店` })) }]
    const result2 = await backfillExternalPlaces({ days: days2, places: cachedResolver, dayCoordinates: () => [] })
    expect(result2.resolved).toBe(8)
    expect(cachedResolve).toHaveBeenCalledTimes(8)
  })

  it('A6：budget.places.reserved 生效——used 未达 max 但预留后余量为 0 时按预算耗尽跳过', async () => {
    const { resolver } = makeResolver()
    const days = [
      {
        dayIndex: 1,
        items: [
          item({ type: 'lodging', title: '京都セントラルホテル', payload: null }),
          item({ type: 'lodging', title: '大阪ホテル', payload: null }),
        ],
      },
    ]
    const result = await backfillExternalPlaces({
      days,
      places: resolver,
      dayCoordinates: () => [],
      budget: { directions: { used: 0, max: 12 }, places: { used: 1, max: 3, reserved: 2 }, windowStartedAt: Date.now() },
    })
    // placesRemaining = 3 - 1 - 2 = 0：即使 used(1) < max(3) 也按耗尽跳过
    expect(result.resolved).toBe(0)
    expect(resolver.resolveByText).not.toHaveBeenCalled()
    expect(result.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: '京都セントラルホテル', reason: expect.stringContaining('预算') })]),
    )
  })

  it('解析抛错/返回 error 时跳过，不抛出', async () => {
    const throwing: PlaceResolver = {
      resolveByText: async () => {
        throw new Error('boom')
      },
      lookup: vi.fn(async () => null),
      remember: vi.fn(),
    }
    const errorReturn = makeResolver({ failFor: ['查不到的店'] })
    const days = [
      {
        dayIndex: 1,
        items: [item({ type: 'meal', title: '抛错的店' }), item({ type: 'meal', title: '查不到的店' })],
      },
    ]
    const result = await backfillExternalPlaces({ days, places: throwing, dayCoordinates: () => [] })
    expect(result.resolved).toBe(0)
    expect(result.skipped).toHaveLength(2) // 两个条目都因抛错被跳过
    expect(days[0].items[0].payload ?? null).toBeNull()

    const result2 = await backfillExternalPlaces({ days: structuredClone(days), places: errorReturn.resolver, dayCoordinates: () => [] })
    expect(result2.resolved).toBe(1) // 只有「查不到的店」失败
    expect(result2.skipped).toContainEqual(expect.objectContaining({ title: '查不到的店' }))
  })

  it('用 payload.placeQuery 优先于 title 作为查询词，并把 near=质心 传给 resolver', async () => {
    const chitosePlace: ResolvedPlace = {
      ...hotelPlace,
      placeId: 'ChIJ_newchitose',
      name: '新千歳空港',
      lat: 42.7889,
      lng: 141.6947,
    }
    const { resolver, resolveByText } = makeResolver({ place: chitosePlace })
    const days = [
      {
        dayIndex: 1,
        items: [
          item({
            type: 'lodging',
            title: '第一晚住宿',
            payload: { placeQuery: '新千歳空港' },
          }),
        ],
      },
    ]
    const coords = [
      { lat: 42.7, lng: 141.6 },
      { lat: 42.9, lng: 141.8 },
    ]
    const result = await backfillExternalPlaces({ days, places: resolver, dayCoordinates: () => coords })
    expect(result.resolved).toBe(1)
    expect(resolveByText).toHaveBeenCalledTimes(1)
    const [query, opts] = resolveByText.mock.calls[0] as unknown as [string, { near?: { lat: number; lng: number } }]
    expect(query).toBe('新千歳空港')
    // 质心 = 坐标平均值
    expect(opts?.near).toMatchObject({ lat: 42.8, lng: 141.7 })
  })

  it('places 未注入时全部跳过（保存仍可继续）', async () => {
    const days = [{ dayIndex: 1, items: [item({ type: 'lodging', title: '某酒店' })] }]
    const result = await backfillExternalPlaces({ days, dayCoordinates: () => [] })
    expect(result.resolved).toBe(0)
    expect(result.skipped).toContainEqual(expect.objectContaining({ title: '某酒店' }))
  })

  it('R2：lunch/dinner meal 不参与兜底解析（留给餐厅 enricher），不消耗预算；dayHasBackfillCandidate 同步', async () => {
    const { resolver, resolveByText } = makeResolver()
    const days = [
      {
        dayIndex: 1,
        items: [
          item({ type: 'meal', title: '午饭', payload: { mealSlot: 'lunch' } }),
          item({ type: 'meal', title: '晚饭', payload: { mealSlot: 'dinner' } }),
          item({ type: 'lodging', title: '京都セントラルホテル' }),
          item({ type: 'lodging', title: '大阪ホテル' }),
        ],
      },
    ]
    const result = await backfillExternalPlaces({
      days,
      places: resolver,
      dayCoordinates: () => [],
      budget: { directions: { used: 0, max: 12 }, places: { used: 0, max: 1 }, windowStartedAt: Date.now() },
    })
    // 预算 1 次：优先给了酒店；lunch/dinner meal 完全不进入解析（不是被预算跳过）
    expect(result.resolved).toBe(1)
    expect(resolveByText).toHaveBeenCalledTimes(1)
    expect(resolveByText).toHaveBeenCalledWith('京都セントラルホテル', expect.anything())
    expect(days[0].items[0].payload?.place ?? null).toBeNull()
    expect(days[0].items[1].payload?.place ?? null).toBeNull()
    // 只有 lunch/dinner meal 的天没有兜底候选（save_plan_days 跳过质心查库）
    expect(dayHasBackfillCandidate([item({ type: 'meal', title: '午饭', payload: { mealSlot: 'lunch' } })])).toBe(false)
    // 早餐/未推断 slot 的 meal 仍参与兜底（原行为）
    expect(dayHasBackfillCandidate([item({ type: 'meal', title: '早饭', payload: { mealSlot: 'breakfast' } })])).toBe(true)
    expect(dayHasBackfillCandidate([item({ type: 'meal', title: '某餐厅' })])).toBe(true)
  })
})
