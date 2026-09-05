import { describe, it, expect, vi } from 'vitest'
import { runRestaurantEnricher } from '@/lib/planAgent/enrich/restaurantEnricher'
import { createEnrichBudget, emptyEnrichReport, type EnrichContext, type EnrichDay } from '@/lib/planAgent/enrich/types'
import type { NearbyRestaurant, NearbySearchResult } from '@/lib/googlePlaces/nearby'

/**
 * R3：餐厅补齐并发化 + 同中心复用 + 预算预扣。
 * - 同中心多餐只打一次 findRestaurants，按取用次序分派不同餐厅；
 * - 预算在发起前预扣（并发不超发），onGoogleCall 只做校准；
 * - 并发上限 4（注入的 findRestaurants 记录同时在飞的数量）。
 */

function restaurant(i: number): NearbyRestaurant {
  return {
    provider: 'google',
    placeId: `ChIJ_rest_${i}`,
    name: `餐厅${i}号`,
    address: null,
    lat: 35.69 + i * 0.001,
    lng: 139.7,
    mapsUri: `https://www.google.com/maps/place/?q=place_id:ChIJ_rest_${i}`,
    photo: null,
    fetchedAt: '2026-09-03T00:00:00.000Z',
    rating: 4.5,
    userRatingsTotal: 100,
    priceLevel: 2,
  }
}

function restaurantsResult(count = 5): NearbySearchResult {
  return { ok: true, restaurants: Array.from({ length: count }, (_, i) => restaurant(i)) }
}

type MealPoint = { pointId: string; lat: number; lng: number; meals: number }

function buildDays(spots: MealPoint[]): EnrichDay[] {
  return [
    {
      dayIndex: 1,
      citySlug: null,
      summary: null,
      items: spots.flatMap((spot) => [
        { type: 'point', pointId: spot.pointId, title: `点位${spot.pointId}` },
        ...Array.from({ length: spot.meals }, (_, i) => ({
          type: 'meal',
          title: `用餐${spot.pointId}-${i + 1}`,
          payload: { mealSlot: i % 2 === 0 ? 'lunch' : 'dinner' },
        })),
      ]),
    },
  ]
}

function buildCtx(
  spots: MealPoint[],
  findRestaurants: NonNullable<EnrichContext['deps']['findRestaurants']>,
  budget = createEnrichBudget(),
): EnrichContext {
  return {
    deps: { findRestaurants },
    coordsByPointId: new Map(spots.map((s) => [s.pointId, { lat: s.lat, lng: s.lng }])),
    budget,
  }
}

describe('runRestaurantEnricher（R3 并发 + 同中心复用 + 预算预扣）', () => {
  it('4 餐同中心：findRestaurants 只调 1 次，四条拿到不同餐厅', async () => {
    const spots = [{ pointId: 'p1', lat: 35.69, lng: 139.7, meals: 4 }]
    const days = buildDays(spots)
    const findRestaurants = vi.fn(async () => restaurantsResult())
    const ctx = buildCtx(spots, findRestaurants)
    const report = emptyEnrichReport()

    await runRestaurantEnricher(days, ctx, report)

    expect(findRestaurants).toHaveBeenCalledTimes(1)
    expect(report.applied.restaurant).toBe(4)
    const meals = days[0]!.items.filter((i) => i.type === 'meal')
    expect(meals).toHaveLength(4)
    const placeIds = meals.map((m) => (m.payload?.place as Record<string, unknown>).placeId)
    expect(placeIds).toEqual(['ChIJ_rest_0', 'ChIJ_rest_1', 'ChIJ_rest_2', 'ChIJ_rest_3'])
    // 备选名单为空时不留尾部「；」；这里含其余候选
    expect(meals[0]!.note).toContain('备选：')
  })

  it('预算 2：只成功 2 条，其余 restaurantPending 且记 skipped(budget)', async () => {
    const spots = Array.from({ length: 4 }, (_, i) => ({ pointId: `p${i + 1}`, lat: 35.69 + i * 0.01, lng: 139.7, meals: 1 }))
    const days = buildDays(spots)
    const findRestaurants = vi.fn(async (input: { onGoogleCall?: () => void }) => {
      input.onGoogleCall?.()
      return restaurantsResult()
    })
    const budget = createEnrichBudget()
    budget.places.max = 2
    const ctx = buildCtx(spots, findRestaurants, budget)
    const report = emptyEnrichReport()

    await runRestaurantEnricher(days, ctx, report)

    expect(findRestaurants).toHaveBeenCalledTimes(2)
    expect(report.applied.restaurant).toBe(2)
    const meals = days[0]!.items.filter((i) => i.type === 'meal')
    const withPlace = meals.filter((m) => m.payload?.place)
    const pending = meals.filter((m) => m.payload?.restaurantPending === true)
    expect(withPlace).toHaveLength(2)
    expect(pending).toHaveLength(2)
    expect(report.skipped.filter((s) => s.reason.includes('预算已用完'))).toHaveLength(2)
    // 预扣与真实外呼一致（每次搜索恰好 1 次外呼，无回退）
    expect(budget.places.used).toBe(2)
  })

  it('并发不超过 4：注入的 findRestaurants 记录同时在飞的数量（8 组搜索全部完成）', async () => {
    const spots = Array.from({ length: 8 }, (_, i) => ({ pointId: `p${i + 1}`, lat: 35.69 + i * 0.01, lng: 139.7, meals: 1 }))
    const days = buildDays(spots)
    let inFlight = 0
    let maxInFlight = 0
    const findRestaurants = vi.fn(async (input: { onGoogleCall?: () => void }) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      input.onGoogleCall?.()
      await new Promise((resolve) => setTimeout(resolve, 10))
      inFlight -= 1
      return restaurantsResult()
    })
    const ctx = buildCtx(spots, findRestaurants)
    const report = emptyEnrichReport()

    await runRestaurantEnricher(days, ctx, report)

    expect(findRestaurants).toHaveBeenCalledTimes(8)
    expect(report.applied.restaurant).toBe(8)
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(maxInFlight).toBe(4)
  })

  it('实际没有外呼时预算回退：同中心第二餐复用缓存，1 次预扣回退后 used 归 0', async () => {
    const spots = [{ pointId: 'p1', lat: 35.69, lng: 139.7, meals: 2 }]
    const days = buildDays(spots)
    // 模拟库/缓存命中：真实实现不打 Google（onGoogleCall 不回调）
    const findRestaurants = vi.fn(async () => restaurantsResult())
    const budget = createEnrichBudget()
    budget.places.max = 1
    const ctx = buildCtx(spots, findRestaurants, budget)
    const report = emptyEnrichReport()

    await runRestaurantEnricher(days, ctx, report)

    expect(findRestaurants).toHaveBeenCalledTimes(1)
    expect(report.applied.restaurant).toBe(2)
    // 同中心聚合只预扣 1 次且无外呼 → 校准回退到 0
    expect(budget.places.used).toBe(0)
  })

  it('S4：同一天两个搜索中心命中同一批候选 → 两餐拿到不同餐厅（按天 placeId 去重）', async () => {
    const spots = [
      { pointId: 'p1', lat: 35.69, lng: 139.7, meals: 1 },
      { pointId: 'p2', lat: 35.7, lng: 139.8, meals: 1 },
    ]
    const days = buildDays(spots)
    // 两组中心各自搜索，命中同一批候选（旧实现两餐都会拿第 1 名）
    const findRestaurants = vi.fn(async () => restaurantsResult())
    const ctx = buildCtx(spots, findRestaurants)
    const report = emptyEnrichReport()

    await runRestaurantEnricher(days, ctx, report)

    expect(findRestaurants).toHaveBeenCalledTimes(2)
    const meals = days[0]!.items.filter((i) => i.type === 'meal')
    const placeIds = meals.map((m) => (m.payload?.place as Record<string, unknown>).placeId)
    expect(placeIds).toEqual(['ChIJ_rest_0', 'ChIJ_rest_1'])
  })

  it('S4：候选全用过才允许同一天重复推荐（单候选两餐 → 第二餐复用第 1 名）', async () => {
    const spots = [{ pointId: 'p1', lat: 35.69, lng: 139.7, meals: 2 }]
    const days = buildDays(spots)
    const findRestaurants = vi.fn(async () => restaurantsResult(1))
    const ctx = buildCtx(spots, findRestaurants)
    const report = emptyEnrichReport()

    await runRestaurantEnricher(days, ctx, report)

    expect(report.applied.restaurant).toBe(2)
    const meals = days[0]!.items.filter((i) => i.type === 'meal')
    const placeIds = meals.map((m) => (m.payload?.place as Record<string, unknown>).placeId)
    expect(placeIds).toEqual(['ChIJ_rest_0', 'ChIJ_rest_0'])
  })

  it('S6：收集阶段逐条释放预留——3 餐里 1 餐无中心，reserved 归零', async () => {
    const days: EnrichDay[] = [
      {
        dayIndex: 1,
        citySlug: null,
        summary: null,
        // 当天无坐标条目、无前一天 → 无搜索中心（旧实现永不释放它的预留）
        items: [{ type: 'meal', title: '午餐', payload: { mealSlot: 'lunch' } }],
      },
      {
        dayIndex: 2,
        citySlug: null,
        summary: null,
        items: [
          { type: 'point', pointId: 'p1', title: '点位p1' },
          { type: 'meal', title: '午餐', payload: { mealSlot: 'lunch' } },
          { type: 'meal', title: '晚餐', payload: { mealSlot: 'dinner' } },
        ],
      },
    ]
    const findRestaurants = vi.fn(async () => restaurantsResult())
    const budget = createEnrichBudget()
    budget.places.reserved = 3 // 模拟 mealEnricher 为 3 个待处理餐各预留 1 个
    const ctx: EnrichContext = {
      deps: { findRestaurants },
      coordsByPointId: new Map([['p1', { lat: 35.69, lng: 139.7 }]]),
      budget,
    }
    const report = emptyEnrichReport()

    await runRestaurantEnricher(days, ctx, report)

    // 不论后续是否派发，3 个收集到的 meal 各释放 1 个预留 → 归零
    expect(budget.places.reserved).toBe(0)
    expect(report.applied.restaurant).toBe(2)
    const noCenter = days[0]!.items[0]!
    expect(noCenter.payload?.restaurantPending).toBe(true)
  })
})
