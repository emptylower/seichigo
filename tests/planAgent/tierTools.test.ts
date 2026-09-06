import { describe, expect, it } from 'vitest'
import { executePlanTool } from '@/lib/planAgent/tools'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { PointFinder } from '@/lib/planAgent/points'

const finder: PointFinder = {
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
    return [{ id: 'p1', lat: 35, lng: 139 }, { id: 'p2', lat: 35.1, lng: 139.1 }]
  },
}

describe('tier gates in executePlanTool', () => {
  it('returns tier_forbidden for forbidden tools without calling anything', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const out = JSON.parse(
      await executePlanTool(
        { planId: plan.id, repo, points: finder, forbiddenTools: new Set(['find_restaurants']) },
        'find_restaurants',
        { lat: 35, lng: 139 },
      ),
    )
    expect(out.code).toBe('tier_forbidden')
  })

  it('caps dayCount in update_plan_meta and cluster_points by maxDays', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const deps = { planId: plan.id, repo, points: finder, maxDays: 3 }
    const meta = JSON.parse(await executePlanTool(deps, 'update_plan_meta', { dayCount: 5 }))
    expect(meta.code).toBe('tier_max_days')
    expect((await repo.getPlan(plan.id))?.dayCount).toBe(1)
    const cluster = JSON.parse(await executePlanTool(deps, 'cluster_points', { pointIds: ['p1', 'p2'], dayCount: 4 }))
    expect(cluster.code).toBe('tier_max_days')
    const ok = JSON.parse(await executePlanTool(deps, 'update_plan_meta', { dayCount: 3 }))
    expect(ok.code).toBeUndefined()
  })

  it('G2：save_plan_days 超 maxDays 返回 tier_max_days 且计划未被写入', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const days = [1, 2, 3, 4].map((d) => ({ dayIndex: d, items: [{ type: 'point', pointId: 'p1', title: 'x' }] }))
    const out = JSON.parse(await executePlanTool({ planId: plan.id, repo, points: finder, maxDays: 3 }, 'save_plan_days', { days }))
    expect(out.code).toBe('tier_max_days')
    expect(out.error).toContain('最多 3 天')
    expect((await repo.getPlan(plan.id))?.days).toHaveLength(0)
  })

  it('G2：不传 maxDays 时 update_plan_meta 传 50 天被钳到 30 而不是报错', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const out = JSON.parse(await executePlanTool({ planId: plan.id, repo, points: finder }, 'update_plan_meta', { dayCount: 50 }))
    expect(out.code).toBeUndefined()
    expect((await repo.getPlan(plan.id))?.dayCount).toBe(30)
  })
})
