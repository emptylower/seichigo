import { describe, expect, it, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'
import { MemoryRouteBookExportStore } from '@/lib/routeBook/exportStoreMemory'
import { createExportRouteBookHandler } from '@/lib/tripPlan/handlers/exportRouteBook'
import type { ExportRouteBookHandlerDeps } from '@/lib/tripPlan/handlers/exportRouteBook'

function makeDeps(overrides?: Partial<ExportRouteBookHandlerDeps>): ExportRouteBookHandlerDeps & { store: MemoryRouteBookExportStore } {
  const repo = new MemoryTripPlanRepo()
  const store = new MemoryRouteBookExportStore()
  return {
    repo,
    store,
    routeBookStore: store,
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    ...overrides,
  }
}

async function seedPlanWithDays(repo: TripPlanRepo, userId = 'u1', title = '京吹巡礼计划') {
  const plan = await repo.createPlan({ userId, title })
  return plan
}

describe('exportRouteBook handler', () => {
  it('rejects unauthenticated, missing, and foreign plans', async () => {
    const deps = makeDeps()
    const handler = createExportRouteBookHandler(deps)

    const unauth = makeDeps({ getSession: vi.fn().mockResolvedValue(null) })
    expect((await createExportRouteBookHandler(unauth).POST('whatever')).status).toBe(401)

    expect((await handler.POST('nope')).status).toBe(404)

    const other = await deps.repo.createPlan({ userId: 'u2', title: 'not mine' })
    expect((await handler.POST(other.id)).status).toBe(403)

    expect(deps.store.books).toHaveLength(0)
  })

  it('exports point items across days with per-day zones and a globally increasing sortOrder', async () => {
    const deps = makeDeps()
    const plan = await seedPlanWithDays(deps.repo)
    await deps.repo.updateMeta(plan.id, { startDate: new Date('2026-10-03T00:00:00.000Z') })
    // 天序故意乱序写入、条目里混入非点位条目和缺 pointId 的 point 条目：
    // 导出必须按 (dayIndex, sortOrder) 摊平、静默跳过无 pointId 的条目
    await deps.repo.replaceDays(plan.id, [
      {
        dayIndex: 2,
        items: [
          { type: 'point', pointId: 'pt-d', title: '大吉山' },
          { type: 'transit', title: 'bus' },
          { type: 'point', pointId: 'pt-e', title: '宇治桥' },
        ],
      },
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'pt-a', title: '吹奏部教室' },
          { type: 'point', title: '缺 pointId 的点位条目' },
          { type: 'meal', title: 'lunch' },
          { type: 'point', pointId: 'pt-b', title: '车站' },
        ],
      },
    ])

    const res = await createExportRouteBookHandler(deps).POST(plan.id)
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ ok: true, routeBookId: 'rb-1', created: true })

    expect(deps.store.books).toHaveLength(1)
    const book = deps.store.books[0]
    expect(book).toMatchObject({
      id: 'rb-1',
      userId: 'u1',
      title: '京吹巡礼计划',
      status: 'draft',
      metadata: { sourcePlanId: plan.id, startDate: '2026-10-03T00:00:00.000Z' },
    })
    expect(book.points).toEqual([
      { pointId: 'pt-a', zone: 'Day 1', sortOrder: 0 },
      { pointId: 'pt-b', zone: 'Day 1', sortOrder: 1 },
      { pointId: 'pt-d', zone: 'Day 2', sortOrder: 2 },
      { pointId: 'pt-e', zone: 'Day 2', sortOrder: 3 },
    ])
  })

  it('reuses the existing route book on repeat export instead of creating a duplicate', async () => {
    const deps = makeDeps()
    const plan = await seedPlanWithDays(deps.repo)
    await deps.repo.replaceDays(plan.id, [
      { dayIndex: 1, items: [{ type: 'point', pointId: 'pt-a', title: 'A' }] },
    ])
    const handler = createExportRouteBookHandler(deps)

    const first = await handler.POST(plan.id)
    expect(first.status).toBe(201)

    const second = await handler.POST(plan.id)
    expect(second.status).toBe(200)
    const body = await second.json()
    expect(body).toEqual({ ok: true, routeBookId: 'rb-1', created: false })

    expect(deps.store.books).toHaveLength(1)
    expect(deps.store.books[0].points).toHaveLength(1)
  })

  it('rejects plans without any exportable point items', async () => {
    const deps = makeDeps()
    const handler = createExportRouteBookHandler(deps)

    // 完全没有天
    const empty = await seedPlanWithDays(deps.repo)
    const emptyRes = await handler.POST(empty.id)
    expect(emptyRes.status).toBe(400)
    await expect(emptyRes.json()).resolves.toEqual({ error: '计划还没有可导出的点位' })

    // 只有非点位条目
    const nonPoint = await seedPlanWithDays(deps.repo)
    await deps.repo.replaceDays(nonPoint.id, [
      { dayIndex: 1, items: [{ type: 'transit', title: 'bus' }, { type: 'meal', title: 'lunch' }] },
    ])
    const nonPointRes = await handler.POST(nonPoint.id)
    expect(nonPointRes.status).toBe(400)

    // 只有缺 pointId 的 point 条目
    const nullPoint = await seedPlanWithDays(deps.repo)
    await deps.repo.replaceDays(nullPoint.id, [
      { dayIndex: 1, items: [{ type: 'point', title: 'no id' }] },
    ])
    const nullPointRes = await handler.POST(nullPoint.id)
    expect(nullPointRes.status).toBe(400)

    expect(deps.store.books).toHaveLength(0)
  })

  it('exports a plan without a start date with a null startDate in metadata', async () => {
    const deps = makeDeps()
    const plan = await seedPlanWithDays(deps.repo)
    await deps.repo.replaceDays(plan.id, [
      { dayIndex: 1, items: [{ type: 'point', pointId: 'pt-a', title: 'A' }] },
    ])

    const res = await createExportRouteBookHandler(deps).POST(plan.id)
    expect(res.status).toBe(201)
    expect(deps.store.books[0].metadata).toEqual({ sourcePlanId: plan.id, startDate: null })
  })
})
