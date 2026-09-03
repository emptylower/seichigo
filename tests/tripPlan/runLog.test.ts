import { describe, it, expect } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { toPlanListItemView, toPlanView } from '@/lib/tripPlan/view'

/** M4 A4：TripPlanRunLog 表 + TripPlan.stage 的 repo 方法（内存实现） */
describe('TripPlanRepo 运行日志与阶段缓存（repoMemory）', () => {
  it('appendRunLog 持久化记录并生成 id/createdAt；listRunLogs 按写入顺序只返回该计划的记录', async () => {
    const repo = new MemoryTripPlanRepo()
    const planA = await repo.createPlan({ userId: 'u1', title: 'a' })
    const planB = await repo.createPlan({ userId: 'u1', title: 'b' })

    const first = await repo.appendRunLog({
      planId: planA.id,
      runToken: 'run-1',
      turnIndex: 1,
      stage: 'works',
      enrichReport: null,
      gateReport: null,
      toolCalls: [{ name: 'search_anime', durationMs: 120 }],
      modelUsage: null,
      durationMs: 1500,
    })
    await repo.appendRunLog({
      planId: planB.id,
      turnIndex: 1,
      stage: 'points',
      durationMs: 800,
    })
    const third = await repo.appendRunLog({
      planId: planA.id,
      turnIndex: 2,
      stage: 'enrich',
      enrichReport: { applied: { place: 1, restaurant: 0, transport: 2, schedule: 0, media: 1 }, skipped: [], googleCallsUsed: { directions: 2, places: 1 } },
      gateReport: {
        passed: false,
        hard: [],
        soft: [],
        stats: { visitItems: 0, withCoords: 0, withMedia: 0, transitLegs: 0, transitReal: 0, transitEstimated: 0, missingTransit: 0, daySpanMaxMin: 0 },
        evaluatedAt: '2026-09-02T00:00:00Z',
      },
      durationMs: 2300,
    })

    expect(first.id).toBeTruthy()
    expect(first.createdAt).toBeInstanceOf(Date)
    const logsOfA = await repo.listRunLogs(planA.id)
    expect(logsOfA).toHaveLength(2)
    expect(logsOfA.map((l) => l.stage)).toEqual(['works', 'enrich'])
    expect(logsOfA[1]).toMatchObject({ id: third.id, runToken: null, turnIndex: 2, durationMs: 2300 })
    expect(logsOfA[0].toolCalls).toEqual([{ name: 'search_anime', durationMs: 120 }])
    expect((await repo.listRunLogs(planB.id)).map((l) => l.stage)).toEqual(['points'])
  })

  it('updateStage 回写计划；toPlanListItemView/toPlanView 暴露 stage 字段', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    expect(toPlanListItemView(plan).stage).toBeNull()

    await repo.updateStage(plan.id, 'enrich')
    const reloaded = await repo.getPlan(plan.id)
    expect(reloaded?.stage).toBe('enrich')
    expect(toPlanListItemView(reloaded!).stage).toBe('enrich')
    expect(toPlanView(reloaded!).stage).toBe('enrich')
  })

  it('updateStage 对不存在的计划静默不报错', async () => {
    const repo = new MemoryTripPlanRepo()
    await expect(repo.updateStage('ghost-plan', 'works')).resolves.toBeUndefined()
  })
})
