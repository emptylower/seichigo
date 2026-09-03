import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import {
  createEnrichBudget,
  modelDirectionsCap,
  modelPlacesCap,
  placesRemaining,
  rollEnrichBudgetWindow,
  ENRICH_BUDGET_WINDOW_MS,
} from '@/lib/planAgent/enrich'
import type { PlaceResolver, ResolvedPlace } from '@/lib/googlePlaces/places'
import type { NearbySearchResult } from '@/lib/googlePlaces/nearby'
import type { PointFinder } from '@/lib/planAgent/points'

/**
 * 回归第三轮 A5：预算兜底三件套。
 * - 预留：模型工具调用最多用到 directions.max-4 / places.max-2，超过返回
 *   budget_exhausted；补齐脚本（save_plan_days enricher）可用完整预算。
 * - 时间窗滚动：距 windowStartedAt ≥ 60s 的下一次检查把 used 归零重开窗口
 *   （测试用可注入的 now()）。
 */

const pointList = Array.from({ length: 2 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `point${i + 1}`,
  nameZh: `点位${i + 1}`,
  lat: 34.88 + i * 0.001,
  lng: 135.8 + i * 0.001,
  ep: '1',
}))

const finder: PointFinder = {
  async searchBangumi() {
    return []
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return pointList
  },
  async getPointsByIds(ids) {
    const all = await this.listPoints(115908, 100)
    return all.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))
  },
}

function travelOk() {
  return {
    ok: true as const,
    mode: 'walking' as const,
    legs: [],
    durationSeconds: 480,
    distanceMeters: 600,
    transfers: 0,
    walkSeconds: 480,
    transitSeconds: 0,
    polyline: [],
  }
}

const somePlace: ResolvedPlace = {
  provider: 'google',
  placeId: 'ChIJ_budget_test',
  name: '测试地点',
  address: null,
  lat: 35.01,
  lng: 135.76,
  mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_budget_test',
  photo: null,
  fetchedAt: '2026-09-02T00:00:00.000Z',
}

describe('A5 预留：模型工具受 max-10/max-10 限制，补齐脚本用完整预算', () => {
  it('cap 计算（R3 上调后）：40/40 → 模型 directions/places 上限各 30', () => {
    const budget = createEnrichBudget()
    expect(budget.directions.max).toBe(40)
    expect(budget.places.max).toBe(40)
    expect(modelDirectionsCap(budget)).toBe(30)
    expect(modelPlacesCap(budget)).toBe(30)
  })

  it('directions.used=cap → estimate_travel 返回 budget_exhausted；enricher 仍可用剩余预算真实查询', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const travel = vi.fn(travelOk)
    const deps: PlanAgentToolDeps = {
      planId: plan.id,
      repo,
      points: finder,
      travel: travel as unknown as PlanAgentToolDeps['travel'],
      enrichBudget: createEnrichBudget(),
    }
    deps.enrichBudget!.directions.used = modelDirectionsCap(deps.enrichBudget!)
    const toolOut = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', { from: { lat: 34.88, lng: 135.8 }, to: { lat: 34.881, lng: 135.801 }, mode: 'walk' }),
    )
    expect(toolOut.code).toBe('budget_exhausted')
    expect(travel).not.toHaveBeenCalled()

    // save 的补齐脚本用完整预算（cap < max）→ 真实查询而非估算
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: pointList.map((p) => ({ type: 'point', pointId: p.id, title: p.nameZh })) }],
      }),
    )
    expect(out.ok).toBe(true)
    expect(travel).toHaveBeenCalledTimes(1)
    const saved = await repo.getPlan(plan.id)
    const transitRows = saved?.days[0].items.filter((i) => i.type === 'transit') ?? []
    expect(transitRows).toHaveLength(1)
    expect(((transitRows[0].payload as Record<string, unknown>).transport as Record<string, unknown>).provider).toBe('google')
  })

  it('places.used=cap（max-10）→ resolve_place 与 find_restaurants 都返回 budget_exhausted，不再外呼', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const resolveByText = vi.fn(async () => ({ ok: true as const, place: somePlace, fromCache: false }))
    const places: PlaceResolver = { resolveByText, lookup: vi.fn(async () => null), remember: vi.fn() }
    const findRestaurants = vi.fn(async () => ({ ok: true as const, restaurants: [] }) as NearbySearchResult)
    const deps: PlanAgentToolDeps = {
      planId: plan.id,
      repo,
      points: finder,
      places,
      findRestaurants,
      enrichBudget: createEnrichBudget(),
    }
    deps.enrichBudget!.places.used = modelPlacesCap(deps.enrichBudget!)
    const placeOut = JSON.parse(await executePlanTool(deps, 'resolve_place', { query: '东京站' }))
    expect(placeOut.code).toBe('budget_exhausted')
    expect(resolveByText).not.toHaveBeenCalled()
    const restaurantOut = JSON.parse(await executePlanTool(deps, 'find_restaurants', { lat: 34.88, lng: 135.8 }))
    expect(restaurantOut.code).toBe('budget_exhausted')
    expect(findRestaurants).not.toHaveBeenCalled()
  })
})

describe('A5 时间窗滚动：距窗口开始 ≥60s 的检查把 used 归零', () => {
  it('rollEnrichBudgetWindow：59.999s 不重置；60s 重置并重开窗口', () => {
    let clock = 1_000_000
    const budget = createEnrichBudget({ now: () => clock })
    budget.directions.used = 12
    budget.places.used = 6
    clock += ENRICH_BUDGET_WINDOW_MS - 1
    rollEnrichBudgetWindow(budget)
    expect(budget.directions.used).toBe(12)
    expect(budget.places.used).toBe(6)
    clock += 1
    rollEnrichBudgetWindow(budget)
    expect(budget.directions.used).toBe(0)
    expect(budget.places.used).toBe(0)
    // 窗口重开后立刻再查不重置
    budget.directions.used = 3
    rollEnrichBudgetWindow(budget)
    expect(budget.directions.used).toBe(3)
  })

  it('A6 placesRemaining：max - used - reserved，下限 0；手写 { used, max } 视为 reserved 0', () => {
    const budget = createEnrichBudget()
    expect(budget.places.reserved).toBe(0)
    expect(placesRemaining(budget)).toBe(40)
    budget.places.used = 38
    budget.places.reserved = 2
    expect(placesRemaining(budget)).toBe(0)
    budget.places.used = 39
    budget.places.reserved = 2
    expect(placesRemaining(budget)).toBe(0) // 不为负
    // 现有测试里手写的预算（无 reserved 字段）不必改：缺省视为 0
    expect(placesRemaining({ directions: { used: 0, max: 12 }, places: { used: 1, max: 2 }, windowStartedAt: Date.now() })).toBe(1)
    // 时间窗滚动不动 reserved
    budget.windowStartedAt = 0
    rollEnrichBudgetWindow(budget)
    expect(budget.places.reserved).toBe(2)
    expect(budget.places.used).toBe(0)
  })

  it('estimate_travel 在窗口滚动后恢复可用（耗尽 → 前进 60s → 再次成功）', async () => {
    let clock = 5_000_000
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const travel = vi.fn(travelOk)
    const deps: PlanAgentToolDeps = {
      planId: plan.id,
      repo,
      points: finder,
      travel: travel as unknown as PlanAgentToolDeps['travel'],
      enrichBudget: createEnrichBudget({ now: () => clock }),
    }
    deps.enrichBudget!.directions.used = deps.enrichBudget!.directions.max
    const exhausted = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', { from: { lat: 34.88, lng: 135.8 }, to: { lat: 34.881, lng: 135.801 }, mode: 'walk' }),
    )
    expect(exhausted.code).toBe('budget_exhausted')
    clock += ENRICH_BUDGET_WINDOW_MS
    const recovered = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', { from: { lat: 34.88, lng: 135.8 }, to: { lat: 34.881, lng: 135.801 }, mode: 'walk' }),
    )
    expect(recovered.ok).toBe(true)
    expect(travel).toHaveBeenCalledTimes(1)
    expect(deps.enrichBudget!.directions.used).toBe(1)
  })
})
