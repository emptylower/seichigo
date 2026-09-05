import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import type { PlaceResolver, ResolvedPlace } from '@/lib/googlePlaces/places'
import type { PointFinder } from '@/lib/planAgent/points'

const finder: PointFinder = {
  async searchBangumi() {
    return []
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return [{ id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' }]
  },
  async getPointsByIds(ids) {
    const all = await this.listPoints(115908, 100)
    return all.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))
  },
}

const hotelPlace: ResolvedPlace = {
  provider: 'google',
  placeId: 'ChIJ_hotel_kyoto',
  name: '京都セントラルホテル',
  address: '京都市中京区',
  lat: 35.0116,
  lng: 135.7681,
  mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_hotel_kyoto',
  photo: {
    photoReference: 'Aref_hotel_1234567890',
    displayUrl: '/api/google/place-photo?placeId=ChIJ_hotel_kyoto&maxwidth=1600',
    attribution: 'Photo by Hotel',
  },
  fetchedAt: '2026-09-02T00:00:00.000Z',
}

function makeFakePlaces(): { places: PlaceResolver; resolveByText: ReturnType<typeof vi.fn> } {
  const resolveByText = vi.fn(async () => ({ ok: true as const, place: hotelPlace, fromCache: false }))
  return {
    resolveByText,
    places: { resolveByText, lookup: vi.fn(async (placeId: string) => (placeId === hotelPlace.placeId ? hotelPlace : null)), remember: vi.fn() },
  }
}

async function makeDeps(places?: PlaceResolver): Promise<{ deps: PlanAgentToolDeps; repo: MemoryTripPlanRepo; planId: string }> {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  return { deps: { planId: plan.id, repo, points: finder, ...(places ? { places } : {}) }, repo, planId: plan.id }
}

describe('save_plan_days 非作品停留点兜底（backfillExternalPlaces 集成）', () => {
  /** M4 质量门控后，相邻有坐标条目之间必须有带 provider 的 transit 行 */
  const transitRow = { type: 'transit' as const, title: '移动', payload: { transport: { mode: 'transit', durationMin: 20, distanceKm: 5, provider: 'google' } } }

  it('lodging 条目（无 place）自动解析：落库后 payload.place 与 payload.media（placeId 代理 URL）都存在', async () => {
    const { places } = makeFakePlaces()
    const { deps, repo, planId } = await makeDeps(places)
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'point', pointId: 'p1', title: '宇治桥' },
              transitRow,
              { type: 'lodging', title: '京都セントラルホテル', timeHint: '19:00' },
            ],
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    expect(out.autoResolvedPlaces).toBe(1)
    expect(places.resolveByText).toHaveBeenCalledWith('京都セントラルホテル', expect.objectContaining({ near: { lat: 34.8892, lng: 135.8075 } }))

    const plan = await repo.getPlan(planId)
    const lodging = plan?.days[0].items.find((i) => i.type === 'lodging')
    const payload = lodging?.payload as Record<string, unknown>
    expect(payload.place).toMatchObject({ placeId: 'ChIJ_hotel_kyoto', lat: 35.0116 })
    expect(payload.media).toMatchObject({
      source: 'google_places',
      displayUrl: '/api/google/place-photo?placeId=ChIJ_hotel_kyoto&maxwidth=1600',
    })
  })

  it('N2：resolve_place 未配置（deps.places 缺省）时：兜底记 skipped，未解析的 lodging 落库成功、soft 含 coords 缺口', async () => {
    const { deps, repo, planId } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'lodging', title: '京都セントラルホテル', timeHint: '19:00' },
              { type: 'point', pointId: 'p1', title: '宇治桥' },
            ],
          },
        ],
      }),
    )
    // N2：meal/lodging 坐标缺口多半是外部服务不可用/限流所致——soft，不拦保存
    expect(out.ok).toBe(true)
    expect(out.quality.passed).toBe(true)
    expect(out.quality.soft).toContainEqual(
      expect.objectContaining({ gate: 'coords', severity: 'soft', itemTitle: '京都セントラルホテル' }),
    )
    expect(out.enrich.skipped).toContainEqual(expect.objectContaining({ enricher: 'place', reason: '地点解析服务未配置' }))
    expect((await repo.getPlan(planId))?.days).toHaveLength(1)
  })

  it('N2：兜底解析失败（not_found，如 Places 限流/查不到）同样落库成功，soft 含 coords、skipped 进 enrich 报告供模型转述', async () => {
    const resolveByText = vi.fn(async () => ({ ok: false as const, code: 'not_found' as const, message: 'Google 没有找到「某餐厅」对应的地点' }))
    const places: PlaceResolver = { resolveByText, lookup: vi.fn(async () => null), remember: vi.fn() }
    const { deps, repo, planId } = await makeDeps(places)
    // timeHint 08:00 → mealSlot=breakfast（R2 起 lunch/dinner meal 留给餐厅 enricher，不走兜底）
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'meal', title: '某餐厅', timeHint: '08:00' }, { type: 'point', pointId: 'p1', title: '宇治桥' }] }],
      }),
    )
    expect(out.ok).toBe(true)
    expect(out.quality.soft).toContainEqual(expect.objectContaining({ gate: 'coords', itemTitle: '某餐厅' }))
    expect(out.enrich.skipped).toContainEqual(expect.objectContaining({ enricher: 'place', itemTitle: '某餐厅' }))
    expect((await repo.getPlan(planId))?.days).toHaveLength(1)
  })

  it('placeQuery 优先于 title 作为查询词', async () => {
    const { places, resolveByText } = makeFakePlaces()
    const { deps } = await makeDeps(places)
    // lodging 而非 meal：R2 起 lunch/dinner meal 不再走 Text Search 兜底
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'lodging', title: '酒店', payload: { placeQuery: '京都セントラルホテル' } }] }],
      }),
    )
    expect(out.ok).toBe(true)
    expect(out.autoResolvedPlaces).toBe(1)
    // 无质心时不带 near 偏置（N3 起第二参恒为携带 onGoogleCall 的对象）
    expect(resolveByText).toHaveBeenCalledTimes(1)
    expect(resolveByText.mock.calls[0]![0]).toBe('京都セントラルホテル')
    expect((resolveByText.mock.calls[0]![1] as { near?: unknown } | undefined)?.near).toBeUndefined()
  })

  it('坐标批量查询一次共享：enrichers/门控/可路由校验复用同一次 getPointsByIds', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const getPointsByIds = vi.fn(async (ids: string[]) => [
      { id: 'p1', lat: 34.8892, lng: 135.8075 },
    ].filter((p) => ids.includes(p.id)))
    const points: PointFinder = {
      ...finder,
      getPointsByIds: getPointsByIds as unknown as PointFinder['getPointsByIds'],
    }
    const deps: PlanAgentToolDeps = { planId: plan.id, repo, points }

    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }] }],
      }),
    )
    expect(out.ok).toBe(true)
    // M4：不再"质心查一次 + 可路由校验查一次"，全程只批量查一次
    expect(getPointsByIds).toHaveBeenCalledTimes(1)

    // 有兜底候选（lodging 缺 place）的天也不再产生第二次查询（质心从共享坐标表聚合）
    const repo2 = new MemoryTripPlanRepo()
    const plan2 = await repo2.createPlan({ userId: 'u1', title: 't' })
    const getPointsByIds2 = vi.fn(async (ids: string[]) => [
      { id: 'p1', lat: 34.8892, lng: 135.8075 },
    ].filter((p) => ids.includes(p.id)))
    const deps2: PlanAgentToolDeps = {
      planId: plan2.id,
      repo: repo2,
      points: { ...finder, getPointsByIds: getPointsByIds2 as unknown as PointFinder['getPointsByIds'] },
    }
    const out2 = JSON.parse(
      await executePlanTool(deps2, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'point', pointId: 'p1', title: '宇治桥' },
              transitRow,
              { type: 'lodging', title: '京都セントラルホテル', timeHint: '19:00' },
            ],
          },
        ],
      }),
    )
    expect(out2.ok).toBe(true) // N2：无 places → lodging 无坐标是 soft，仍落库
    expect(getPointsByIds2).toHaveBeenCalledTimes(1)
  })
})
