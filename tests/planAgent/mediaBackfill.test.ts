import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import { createMemoryExternalPlaceStore } from '@/lib/googlePlaces/storeMemory'
import type { PlaceResolver, ResolvedPlace } from '@/lib/googlePlaces/places'
import type { PointFinder } from '@/lib/planAgent/points'

/**
 * 回归第三轮 A2（保存路径）：find_restaurants 已把完整 place（含 photo）返回，
 * 但模型只把 placeId/name/lat/lng 照抄进 meal 条目——save_plan_days 的
 * media enricher 应经地点库按 placeId 回填 place.photo 并派生 payload.media，
 * 保存后 DayCards 不再是灰色占位。出处校验只对 name/provider/lat/lng 逐字段
 * 一致，裁剪照抄的 place 能正常通过。
 */

const canonicalPlace: ResolvedPlace = {
  provider: 'google',
  placeId: 'ChIJ_ramen_full',
  name: '拉面一乐',
  address: '京都市',
  lat: 34.8895,
  lng: 135.8079,
  mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_ramen_full',
  photo: {
    photoReference: 'Aref_ramen_full_1234567890',
    displayUrl: '/api/google/place-photo?placeId=ChIJ_ramen_full&maxwidth=1600',
    attribution: 'Photo by Ramen',
  },
  fetchedAt: '2026-09-02T00:00:00.000Z',
}

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

describe('A2：模型裁剪过的 place 在保存时回填 photo 并派生 media', () => {
  it('meal 条目只有 placeId/name/lat/lng → 保存后 payload.media.displayUrl 存在（placeId 寻址）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const store = createMemoryExternalPlaceStore()
    await store.upsert(canonicalPlace, null)
    const places: PlaceResolver = {
      resolveByText: vi.fn(),
      lookup: vi.fn(async () => canonicalPlace),
      remember: vi.fn(),
    }
    const deps: PlanAgentToolDeps = { planId: plan.id, repo, points: finder, places, externalPlaces: store }
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'point', pointId: 'p1', title: '宇治桥' },
              {
                type: 'meal',
                title: '晚饭',
                // 模型裁剪照抄：provider/placeId/name/lat/lng，photo/media 都没带
                payload: {
                  place: { provider: 'google', placeId: 'ChIJ_ramen_full', name: '拉面一乐', lat: 34.8895, lng: 135.8079 },
                },
              },
            ],
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    expect(out.enrich.applied.media).toBe(1)
    const saved = await repo.getPlan(plan.id)
    const meal = saved?.days[0].items.find((i) => i.type === 'meal')
    const payload = (meal?.payload ?? {}) as Record<string, unknown>
    expect((payload.media as Record<string, unknown> | undefined)?.displayUrl).toBe(
      '/api/google/place-photo?placeId=ChIJ_ramen_full&maxwidth=1600',
    )
    expect((payload.place as Record<string, unknown>).photo).toMatchObject({ photoReference: 'Aref_ramen_full_1234567890' })
  })
})
