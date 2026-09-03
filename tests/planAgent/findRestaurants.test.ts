import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import { createNearbySearch } from '@/lib/googlePlaces/nearby'
import { createPlaceResolver } from '@/lib/googlePlaces/places'
import { createMemoryExternalPlaceStore } from '@/lib/googlePlaces/storeMemory'

/**
 * A3 find_restaurants 工具：返回形状、出处三件套、错误路径，
 * 以及 find_restaurants → save_plan_days(meal) 的出处闭环。
 */

const finder = {
  async searchBangumi() {
    return []
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return []
  },
  async getPointsByIds() {
    return []
  },
}

function nearbyBody(results: Array<Record<string, unknown>>) {
  return { ok: true, json: async () => ({ status: 'OK', results }) } as unknown as Response
}

/** 贴合生产装配：nearby 与 resolver 共享 store，模型照抄的 place 可通过出处校验 */
async function makeDeps() {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  const store = createMemoryExternalPlaceStore()
  const fetchImpl = vi.fn(async () =>
    nearbyBody([
      {
        place_id: 'ChIJ_ramen',
        name: '新宿拉面名店',
        vicinity: '東京都新宿区',
        geometry: { location: { lat: 35.695, lng: 139.705 } },
        rating: 4.6,
        user_ratings_total: 512,
        price_level: 2,
        photos: [{ photo_reference: 'Aref_ramen_1234567890', html_attributions: [] }],
      },
      {
        place_id: 'ChIJ_sushi',
        name: '回转寿司',
        vicinity: '東京都新宿区',
        geometry: { location: { lat: 35.696, lng: 139.706 } },
        rating: 4.3,
        user_ratings_total: 150,
      },
    ]),
  )
  const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, rateKey: 'fr-tool', store })
  const findRestaurants = createNearbySearch({ apiKey: 'k', fetchImpl, rateKey: 'fr-tool', store, resolver })
  const deps: PlanAgentToolDeps = {
    planId: plan.id,
    repo,
    points: finder,
    places: resolver,
    findRestaurants,
  }
  return { deps, repo, planId: plan.id }
}

describe('find_restaurants 工具（A3）', () => {
  it('返回按评分排序的餐厅与每家可照抄的 optionProvenance 三件套', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'find_restaurants', { lat: 35.6938, lng: 139.7034, keyword: '拉面' }),
    )
    expect(out.ok).toBe(true)
    expect(out.restaurants).toHaveLength(2)
    const [first, second] = out.restaurants
    expect(first).toMatchObject({ placeId: 'ChIJ_ramen', provider: 'google', rating: 4.6, userRatingsTotal: 512, priceLevel: 2 })
    expect(first.optionProvenance).toMatchObject({
      sourceKind: 'google_places',
      sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ_ramen',
    })
    expect(first.optionProvenance.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(second.optionProvenance.sourceUrl).toContain('ChIJ_sushi')
    expect(JSON.stringify(out)).not.toContain('key=k')
  })

  it('未注入服务（无 key）→ 显式配置错误，引导如实告知', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const out = JSON.parse(
      await executePlanTool({ planId: plan.id, repo, points: finder }, 'find_restaurants', { lat: 1, lng: 2 }),
    )
    expect(out.error).toContain('未配置')
  })

  it('缺 lat/lng 或坐标非法 → 参数错误', async () => {
    const { deps } = await makeDeps()
    const noLat = JSON.parse(await executePlanTool(deps, 'find_restaurants', { lng: 139 }))
    expect(noLat.error).toContain('lat/lng')
    const bad = JSON.parse(await executePlanTool(deps, 'find_restaurants', { lat: 999, lng: 139 }))
    expect(bad.error).toBeTruthy()
  })

  it('无合格结果 → typed not_found 错误（可换关键词/扩半径重试一次）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const deps: PlanAgentToolDeps = {
      planId: plan.id,
      repo,
      points: finder,
      findRestaurants: async () => ({ ok: true, restaurants: [] }),
    }
    const out = JSON.parse(await executePlanTool(deps, 'find_restaurants', { lat: 1, lng: 2 }))
    expect(out.code).toBe('not_found')
    expect(out.error).toContain('餐厅')
  })

  it('服务返回 typed 错误时原样透出', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const deps: PlanAgentToolDeps = {
      planId: plan.id,
      repo,
      points: finder,
      findRestaurants: async () => ({ ok: false, code: 'rate_limited', message: '请求过于频繁' }),
    }
    const out = JSON.parse(await executePlanTool(deps, 'find_restaurants', { lat: 1, lng: 2 }))
    expect(out).toMatchObject({ code: 'rate_limited', error: '请求过于频繁' })
  })

  it('出处闭环：find_restaurants 选出的餐厅照抄进 meal 条目可正常保存', async () => {
    const { deps, repo, planId } = await makeDeps()
    const found = JSON.parse(
      await executePlanTool(deps, 'find_restaurants', { lat: 35.6938, lng: 139.7034 }),
    )
    expect(found.ok).toBe(true)
    // 模型照抄：place（剥离附带的 optionProvenance/rating 等兄弟字段的完整对象）
    const { optionProvenance: _p, rating: _r, userRatingsTotal: _u, priceLevel: _pl, ...place } = found.restaurants[0]
    const saved = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'meal', title: '新宿拉面名店', timeHint: '12:00', payload: { place } },
            ],
          },
        ],
      }),
    )
    expect(saved.ok).toBe(true)
    const plan = await repo.getPlan(planId)
    const meal = plan?.days[0].items[0]
    const payload = meal?.payload as Record<string, unknown>
    expect(payload.place).toMatchObject({ placeId: 'ChIJ_ramen' })
    // place.photo 安全代理 URL → media 派生防线补齐 payload.media。
    // A2：nearby 结果 upsert 入库成功后 displayUrl 升级 placeId 寻址
    expect(payload.media).toMatchObject({ source: 'google_places', displayUrl: '/api/google/place-photo?placeId=ChIJ_ramen&maxwidth=1600' })
  })
})
