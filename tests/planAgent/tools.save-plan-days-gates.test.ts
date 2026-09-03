import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import { parseDaymapPayload } from '@/lib/tripPlan/view'
import type { PointFinder } from '@/lib/planAgent/points'

/**
 * M4 A5：save_plan_days 的质量门控——缺交通是 soft（照常落库、进报告，
 * 留给下一回合的 enricher 补齐），补齐后 quality 干净且 daymap 快照携带报告。
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
      { id: 'p2', name: '大吉山', nameZh: '大吉山', lat: 34.8963, lng: 135.8123, ep: '8' },
    ]
  },
  async getPointsByIds(ids) {
    const all = await this.listPoints(115908, 100)
    return all.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))
  },
}

const transitRow = {
  type: 'transit' as const,
  title: '宇治桥 → 大吉山',
  payload: { transport: { mode: 'walk', durationMin: 8, distanceKm: 0.65, provider: 'google' } },
}

async function makeDeps() {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  const onSaveEvaluated = vi.fn()
  const deps: PlanAgentToolDeps = { planId: plan.id, repo, points: finder, onSaveEvaluated }
  return { deps, repo, planId: plan.id, onSaveEvaluated }
}

describe('save_plan_days 质量门控（M4）', () => {
  it('deps.travel 缺省（A5）→ 零外呼估算补齐交通缺口后保存成功，不再留 transport 软缺口', async () => {
    const { deps, repo, planId, onSaveEvaluated } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'point', pointId: 'p1', title: '宇治桥' },
              { type: 'point', pointId: 'p2', title: '大吉山' },
            ],
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    expect(out.quality.passed).toBe(true)
    // 交通缺口由直线距离估算补齐（provider estimate + source heuristic）：
    // 不再产生 transport 软缺口，改为估算占比提示（soft）
    expect(out.quality.stats.missingTransit).toBe(0)
    expect(out.quality.soft).not.toContainEqual(expect.objectContaining({ gate: 'transport' }))
    expect(out.enrich.applied.transport).toBe(1)
    // 补齐的天照常落库（估算行在两个点位之间）
    const saved = await repo.getPlan(planId)
    expect(saved?.days).toHaveLength(1)
    expect(saved?.days[0].items).toHaveLength(3)
    expect((saved?.days[0].items[1].payload as Record<string, unknown>).transport).toMatchObject({
      provider: 'estimate',
      source: 'heuristic',
    })
    const daymapRow = (await repo.listMessages(planId)).find((m) => m.kind === 'daymap')
    expect(daymapRow).toBeDefined()
    // loop 依赖的回调拿到本次评估
    expect(onSaveEvaluated).toHaveBeenCalledTimes(1)
    expect(onSaveEvaluated.mock.calls[0][0].quality.passed).toBe(true)
  })

  it('补齐交通后 → 通过落库，daymap 快照与工具返回值都携带 quality', async () => {
    const { deps, repo, planId, onSaveEvaluated } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }, transitRow, { type: 'point', pointId: 'p2', title: '大吉山' }],
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    expect(out.quality.passed).toBe(true)
    expect(out.quality.stats).toMatchObject({ visitItems: 2, transitLegs: 1, transitReal: 1, missingTransit: 0 })
    expect(out.enrich).toBeDefined()

    const daymapRow = (await repo.listMessages(planId)).find((m) => m.kind === 'daymap')
    expect(daymapRow).toBeDefined()
    const payload = parseDaymapPayload(daymapRow!.content)
    expect(payload?.quality).toMatchObject({ passed: true })
    expect(payload?.quality?.stats.visitItems).toBe(2)
    expect(onSaveEvaluated).toHaveBeenCalledTimes(1)
    expect(onSaveEvaluated.mock.calls[0][0].quality.passed).toBe(true)
  })

  it('transportEnricher 可自动补齐缺交通的行程：注入 travel 后同一份 days 直接过门控', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const travel = vi.fn(async () => ({
      ok: true as const,
      mode: 'walking' as const,
      legs: [],
      durationSeconds: 480,
      distanceMeters: 600,
      transfers: 0,
      walkSeconds: 480,
      transitSeconds: 0,
      polyline: [],
    }))
    const deps: PlanAgentToolDeps = { planId: plan.id, repo, points: finder, travel }
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'point', pointId: 'p1', title: '宇治桥' },
              { type: 'point', pointId: 'p2', title: '大吉山' },
            ],
          },
        ],
      }),
    )
    // 补齐层插入了 transit 行 → 门控通过；返回值报告本次自动补齐
    expect(travel).toHaveBeenCalledTimes(1)
    expect(out.ok).toBe(true)
    expect(out.enrich.applied.transport).toBe(1)
    expect(out.quality.stats.missingTransit).toBe(0)
    const saved = await repo.getPlan(plan.id)
    expect(saved?.days[0].items.filter((i) => i.type === 'transit')).toHaveLength(1)
  })
})
