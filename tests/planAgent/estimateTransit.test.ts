import { describe, it, expect } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import type { PointFinder } from '@/lib/planAgent/points'

/**
 * M4 修复 #1：estimate_transit 兜底结果补齐 provider/estimated 与完整
 * transportPayload（形状同 queryTravelBetween 的估算分支）——让模型的兜底
 * 结果能过出处门，并被前端标注"参考估算"。
 */

const finder: PointFinder = {
  async searchBangumi() {
    return []
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return [
      { id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' },
      { id: 'p2', name: '京都駅', nameZh: '京都站', lat: 34.9858, lng: 135.7585, ep: '2' },
    ]
  },
  async getPointsByIds(ids) {
    const all = await this.listPoints(115908, 100)
    return all.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))
  },
}

async function makeDeps() {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  const deps: PlanAgentToolDeps = { planId: plan.id, repo, points: finder }
  return { deps }
}

describe('estimate_transit 兜底估算载荷（M4 #1）', () => {
  it('返回 estimated/provider 与完整 transportPayload：照抄进 payload.transport 即可通过出处门', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'estimate_transit', { fromPointId: 'p1', toPointId: 'p2' }))
    expect(out.estimated).toBe(true)
    expect(out.provider).toBe('estimate')
    expect(out.mode).toBe('transit')
    expect(out.transportPayload).toMatchObject({
      mode: 'transit',
      provider: 'estimate',
      estimated: true,
      transfers: null,
      legs: [],
    })
    expect(out.transportPayload.durationMin).toBe(out.durationMin)
    expect(out.transportPayload.distanceKm).toBe(out.distanceKm)
    expect(typeof out.transportPayload.fetchedAt).toBe('string')
    expect(out.mapsUrl).toContain('https://www.google.com/maps/dir/')
    expect(out.transportPayload.mapsUrl).toBe(out.mapsUrl)
    expect(out.note).toContain('参考')
  })

  it('短距离（≤1.5km）用步行模式', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'estimate_transit', { fromPointId: 'p1', toPointId: 'p1' }))
    expect(out.mode).toBe('walk')
    expect(out.transportPayload.mode).toBe('walk')
  })
})
