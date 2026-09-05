import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import { createEnrichBudget } from '@/lib/planAgent/enrich'
import type { PlaceResolver, ResolvedPlace } from '@/lib/googlePlaces/places'
import type { NearbySearchResult } from '@/lib/googlePlaces/nearby'
import type { PointFinder } from '@/lib/planAgent/points'

/**
 * N4：模型自己的工具调用（estimate_travel / resolve_place / find_restaurants）
 * 与 enricher 共享同一 run 的 EnrichBudget（deps.enrichBudget，由 loop 每个
 * run 创建一次）；预算桶用尽时工具返回 code=budget_exhausted，引导先保存
 * 当前进度、下一回合继续补，绝不换工具重试。
 */

const pointList = Array.from({ length: 11 }, (_, i) => ({
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

async function makeDeps() {
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
  return { deps, repo, planId: plan.id, travel }
}

async function estimateTravelOnce(deps: PlanAgentToolDeps, i: number) {
  return JSON.parse(
    await executePlanTool(deps, 'estimate_travel', {
      from: { lat: 34.88 + i * 0.01, lng: 135.8 },
      to: { lat: 34.881 + i * 0.01, lng: 135.801 },
      mode: 'walk',
    }),
  )
}

const somePlace: ResolvedPlace = {
  provider: 'google',
  placeId: 'ChIJ_n4_test',
  name: '测试地点',
  address: null,
  lat: 35.01,
  lng: 135.76,
  mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_n4_test',
  photo: null,
  fetchedAt: '2026-09-02T00:00:00.000Z',
}

describe('N4：模型工具调用计入同一 run 的补齐预算', () => {
  it('estimate_travel 调 3 次后 directions.used=3；enricher 只剩 9 次可用，超出腿记 skipped(budget)', async () => {
    const { deps, repo, planId, travel } = await makeDeps()
    for (let i = 0; i < 3; i++) {
      const out = await estimateTravelOnce(deps, i)
      expect(out.ok).toBe(true)
    }
    expect(deps.enrichBudget!.directions).toEqual({ used: 3, max: 40 })
    expect(travel).toHaveBeenCalledTimes(3)
    // R3 默认预算上调到 40；把 used 推进到 31，让 enricher 只剩 9 次真实查询，
    // 以继续覆盖"超出腿走零外呼估算兜底（A5：不留空）"的边界
    deps.enrichBudget!.directions.used = 31

    // 11 个点位需要 10 条腿，但 enricher 只剩 40-31=9 次预算：
    // 前 9 条真实查询，第 10 条腿走零外呼估算兜底（A5：不留空），
    // 全部落库且不重复外呼
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: pointList.map((p) => ({ type: 'point', pointId: p.id, title: p.nameZh })),
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    expect(out.enrich.applied.transport).toBe(10)
    expect(travel).toHaveBeenCalledTimes(12)
    expect(deps.enrichBudget!.directions.used).toBe(40)
    const saved = await repo.getPlan(planId)
    const transitRows = (saved?.days[0].items ?? []).filter((i) => i.type === 'transit')
    expect(transitRows).toHaveLength(10)
    const heuristicRows = transitRows.filter(
      (r) => ((r.payload as Record<string, unknown>)?.transport as Record<string, unknown> | undefined)?.source === 'heuristic',
    )
    expect(heuristicRows).toHaveLength(1)
    expect((heuristicRows[0].payload as Record<string, unknown>).transport).toMatchObject({ provider: 'estimate', estimated: true })
  })

  it('预算耗尽：三个工具都返回 code=budget_exhausted，不再发起任何外呼', async () => {
    const { deps, travel } = await makeDeps()
    deps.enrichBudget!.directions.used = deps.enrichBudget!.directions.max
    deps.enrichBudget!.places.used = deps.enrichBudget!.places.max

    const travelOut = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: { lat: 34.88, lng: 135.8 },
        to: { lat: 34.881, lng: 135.801 },
        mode: 'walk',
      }),
    )
    expect(travelOut.code).toBe('budget_exhausted')
    expect(travelOut.error).toContain('请立即保存')
    expect(travel).not.toHaveBeenCalled()

    const resolveByText = vi.fn(async () => ({ ok: true as const, place: somePlace, fromCache: false }))
    const places: PlaceResolver = { resolveByText, lookup: vi.fn(async () => null), remember: vi.fn() }
    const depsWithPlaces: PlanAgentToolDeps = { ...deps, places }
    const placeOut = JSON.parse(await executePlanTool(depsWithPlaces, 'resolve_place', { query: '东京站' }))
    expect(placeOut.code).toBe('budget_exhausted')
    expect(resolveByText).not.toHaveBeenCalled()

    const findRestaurants = vi.fn(async () => ({ ok: true as const, restaurants: [] }) as NearbySearchResult)
    const depsWithRestaurants: PlanAgentToolDeps = { ...depsWithPlaces, findRestaurants }
    const restaurantOut = JSON.parse(
      await executePlanTool(depsWithRestaurants, 'find_restaurants', { lat: 34.88, lng: 135.8 }),
    )
    expect(restaurantOut.code).toBe('budget_exhausted')
    expect(findRestaurants).not.toHaveBeenCalled()
  })
})
