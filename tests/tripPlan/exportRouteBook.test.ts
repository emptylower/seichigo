import { describe, expect, it, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanRepo, TripPlanWithDays } from '@/lib/tripPlan/repo'
import { MemoryRouteBookExportStore } from '@/lib/routeBook/exportStoreMemory'
import { createExportRouteBookHandler } from '@/lib/tripPlan/handlers/exportRouteBook'
import type { ExportRouteBookHandlerDeps } from '@/lib/tripPlan/handlers/exportRouteBook'
import { buildExportInput } from '@/lib/tripPlan/exportMapping'

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

const HOTEL = (placeId: string, name: string) => ({
  type: 'lodging' as const,
  title: name,
  payload: { place: { placeId, name, lat: 35.01, lng: 135.76 } },
})

async function seededPlan(repo: TripPlanRepo, days: Parameters<TripPlanRepo['replaceDays']>[1], title = '京吹巡礼计划'): Promise<TripPlanWithDays> {
  const plan = await repo.createPlan({ userId: 'u1', title })
  await repo.replaceDays(plan.id, days)
  const loaded = await repo.getPlan(plan.id)
  if (!loaded) throw new Error('plan not loaded')
  return loaded
}

describe('exportRouteBook handler 鉴权', () => {
  it('未登录 401 / 不存在 404 / 他人计划 403', async () => {
    const deps = makeDeps()
    const handler = createExportRouteBookHandler(deps)

    const unauth = makeDeps({ getSession: vi.fn().mockResolvedValue(null) })
    expect((await createExportRouteBookHandler(unauth).POST('whatever')).status).toBe(401)
    expect((await handler.POST('nope')).status).toBe(404)

    const other = await deps.repo.createPlan({ userId: 'u2', title: 'not mine' })
    expect((await handler.POST(other.id)).status).toBe(403)
    expect(deps.store.books).toHaveLength(0)
  })

  it('没有可导出的条目 → 400', async () => {
    const deps = makeDeps()
    const empty = await seededPlan(deps.repo, [{ dayIndex: 1, items: [{ type: 'point', title: '无 id' }] }])
    const res = await createExportRouteBookHandler(deps).POST(empty.id)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: '计划还没有可导出的条目' })
  })

  it('重复导入幂等：第二次返回 created:false 且不再建本', async () => {
    const deps = makeDeps()
    const plan = await seededPlan(deps.repo, [{ dayIndex: 1, items: [{ type: 'point', pointId: 'pt-a', title: 'A' }] }])
    const handler = createExportRouteBookHandler(deps)

    const first = await handler.POST(plan.id)
    expect(first.status).toBe(201)
    const second = await handler.POST(plan.id)
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({ ok: true, routeBookId: 'rb-1', created: false })
    expect(deps.store.books).toHaveLength(1)
  })
})

describe('buildExportInput 六种条目映射', () => {
  it('point/meal/place/降级 note/free/transit 全覆盖，时间三来源，transitBetween 指向正确', async () => {
    const deps = makeDeps()
    const plan = await seededPlan(deps.repo, [
      {
        dayIndex: 1,
        summary: 'Day 1 京吹圣地巡礼，从吹奏部教室出发',
        items: [
          {
            type: 'point',
            pointId: 'pt-a',
            title: '吹奏部教室',
            payload: { schedule: { start: '09:00', end: '10:00', confidence: 'explicit' } },
          },
          { type: 'point', pointId: 'pt-b', title: '大吉山', timeHint: '9:30 集合' },
          {
            type: 'meal',
            title: '午饭',
            payload: { place: { placeId: 'gp-1', name: '宇治食堂', address: '宇治市...', lat: '35.01', lng: '135.80' } },
          },
          { type: 'meal', title: '没坐标的店', payload: { place: { name: '黑店' } } },
          { type: 'point', title: '缺 pointId 被跳过' },
          { type: 'free', title: '自由活动', note: '逛商店街' },
        ],
      },
      {
        dayIndex: 2,
        items: [
          { type: 'point', pointId: 'pt-c', title: '宇治桥', payload: { schedule: { start: '14:00', confidence: 'inferred' } } },
          {
            type: 'transit',
            title: '步行去神社',
            payload: { transport: { mode: 'walk', durationMin: 12, distanceKm: 0.9 } },
          },
          { type: 'point', pointId: 'pt-d', title: '神社' },
        ],
      },
    ])

    const { input, counts } = buildExportInput(plan)

    expect(input.dayCount).toBe(2)
    expect(input.startDate).toBeNull()
    expect(input.metadata).toEqual({ sourcePlanId: plan.id, startDate: null })
    expect(input.days).toHaveLength(2)
    expect(input.days[0]).toMatchObject({ dayIndex: 1, title: 'Day 1 京吹圣地巡礼，从吹奏部教室出发' })
    expect(input.days[1]).toMatchObject({ dayIndex: 2, title: null })

    expect(input.places).toHaveLength(1)
    expect(input.places[0]).toMatchObject({ kind: 'restaurant', title: '宇治食堂', address: '宇治市...', lat: 35.01, lng: 135.8 })

    const day1 = input.items.filter((item) => item.dayIndex === 1)
    expect(day1.map((item) => item.kind)).toEqual(['point', 'point', 'place', 'note', 'note'])
    expect(day1.map((item) => item.sortOrder)).toEqual([0, 1, 2, 3, 4])
    expect(day1[0]).toMatchObject({ pointId: 'pt-a', timeStart: '09:00', timeEnd: '10:00', locked: true })
    expect(day1[1]).toMatchObject({ pointId: 'pt-b', timeStart: '09:30', locked: false })
    expect(day1[2]).toMatchObject({ placeTempId: input.places[0]!.tempId })
    expect(day1[3]).toMatchObject({ kind: 'note', title: '没坐标的店' })
    expect(day1[4]).toMatchObject({ kind: 'note', title: '自由活动', note: '逛商店街' })

    const day2 = input.items.filter((item) => item.dayIndex === 2)
    expect(day2.map((item) => item.kind)).toEqual(['point', 'transit', 'point'])
    expect(day2[0]).toMatchObject({ pointId: 'pt-c', timeStart: '14:00', locked: false })
    const transitPayload = day2[1]!.payload as { transitBetween: { prevItemId: string; nextItemId: string }; transport: { mode: string } }
    expect(transitPayload.transitBetween.prevItemId).toBe(day2[0]!.id)
    expect(transitPayload.transitBetween.nextItemId).toBe(day2[2]!.id)
    expect(transitPayload.transport).toEqual({ mode: 'walk', durationMin: 12, distanceKm: 0.9 })

    expect(counts).toEqual({ days: 2, points: 4, places: 1, notes: 2, transits: 1, lodgings: 0, degradedToNote: 1 })
  })

  it('transit 缺下一侧邻居 → 降级 note 并计数', async () => {
    const deps = makeDeps()
    const plan = await seededPlan(deps.repo, [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'pt-a', title: 'A' },
          { type: 'transit', title: '末班交通', payload: { transport: { mode: 'transit', durationMin: 20, distanceKm: 5 } } },
        ],
      },
    ])

    const { input, counts } = buildExportInput(plan)
    const transitItem = input.items[1]!
    expect(transitItem.kind).toBe('note')
    expect(transitItem.payload).toBeUndefined()
    expect(counts.transits).toBe(0)
    expect(counts.degradedToNote).toBe(1)
  })
})

describe('buildExportInput 住宿区间合并', () => {
  it('同一酒店连续三晚（day1-3，dayCount=4）→ [1,4]；dayCount=3 封顶 [1,3]', async () => {
    const deps = makeDeps()
    const fourDays = await seededPlan(deps.repo, [
      { dayIndex: 1, items: [HOTEL('h1', '京都站酒店')] },
      { dayIndex: 2, items: [HOTEL('h1', '京都站酒店')] },
      { dayIndex: 3, items: [HOTEL('h1', '京都站酒店')] },
      { dayIndex: 4, items: [{ type: 'point', pointId: 'pt-a', title: 'A' }] },
    ])

    const four = buildExportInput(fourDays)
    expect(four.input.lodgings).toEqual([{ placeTempId: expect.any(String), fromDayIndex: 1, toDayIndex: 4 }])
    expect(four.input.dayCount).toBe(4)
    expect(four.counts.lodgings).toBe(1)
    // 住宿不建条目
    expect(four.input.items.every((item) => item.kind === 'point')).toBe(true)

    const threeDays = await seededPlan(deps.repo, [
      { dayIndex: 1, items: [HOTEL('h1', '京都站酒店')] },
      { dayIndex: 2, items: [HOTEL('h1', '京都站酒店')] },
      { dayIndex: 3, items: [HOTEL('h1', '京都站酒店')] },
    ])
    const three = buildExportInput(threeDays)
    expect(three.input.lodgings).toEqual([{ placeTempId: expect.any(String), fromDayIndex: 1, toDayIndex: 3 }])
  })

  it('中间换酒店拆两个背靠背区间；隔天出现拆开', async () => {
    const deps = makeDeps()
    const plan = await seededPlan(deps.repo, [
      { dayIndex: 1, items: [HOTEL('h1', '酒店A')] },
      { dayIndex: 2, items: [HOTEL('h2', '酒店B')] },
      { dayIndex: 3, items: [HOTEL('h2', '酒店B')] },
    ])

    const { input } = buildExportInput(plan)
    expect(input.lodgings).toEqual([
      { placeTempId: expect.any(String), fromDayIndex: 1, toDayIndex: 2 },
      { placeTempId: expect.any(String), fromDayIndex: 2, toDayIndex: 3 },
    ])

    const gapped = await seededPlan(deps.repo, [
      { dayIndex: 1, items: [HOTEL('h1', '酒店A')] },
      { dayIndex: 3, items: [HOTEL('h1', '酒店A')] },
    ])
    const gappedInput = buildExportInput(gapped).input
    expect(gappedInput.lodgings).toEqual([
      { placeTempId: expect.any(String), fromDayIndex: 1, toDayIndex: 2 },
      { placeTempId: expect.any(String), fromDayIndex: 3, toDayIndex: 3 },
    ])
  })

  it('非法住宿载荷降级 note', async () => {
    const deps = makeDeps()
    const plan = await seededPlan(deps.repo, [
      { dayIndex: 1, items: [{ type: 'lodging', title: '神秘住处', payload: { place: { name: '无坐标' } } }] },
    ])
    const { input, counts } = buildExportInput(plan)
    expect(input.items[0]).toMatchObject({ kind: 'note', title: '神秘住处' })
    expect(input.lodgings).toHaveLength(0)
    expect(counts.degradedToNote).toBe(1)
  })
})

describe('exportRouteBook handler 落库', () => {
  it('创建成功返回 counts，store 记录完整结构', async () => {
    const deps = makeDeps()
    const plan = await seededPlan(
      deps.repo,
      [
        { dayIndex: 1, items: [{ type: 'point', pointId: 'pt-a', title: 'A' }, { type: 'lodging', title: '酒店', payload: { place: { placeId: 'h1', name: '酒店', lat: 35, lng: 135 } } }] },
        { dayIndex: 2, items: [{ type: 'point', pointId: 'pt-b', title: 'B' }, HOTEL('h1', '酒店')] },
      ],
      '京吹两日'
    )

    const res = await createExportRouteBookHandler(deps).POST(plan.id)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ok: boolean; routeBookId: string; created: boolean; counts: Record<string, number> }
    expect(body).toMatchObject({ ok: true, routeBookId: 'rb-1', created: true })
    expect(body.counts).toMatchObject({ days: 2, points: 2, lodgings: 1 })

    const book = deps.store.books[0]!
    expect(book).toMatchObject({ userId: 'u1', title: '京吹两日', status: 'draft', dayCount: 2 })
    expect(book.days.map((day) => day.dayIndex)).toEqual([1, 2])
    expect(book.items.map((item) => item.pointId)).toEqual(['pt-a', 'pt-b'])
    expect(book.lodgings).toEqual([{ placeTempId: expect.any(String), fromDayIndex: 1, toDayIndex: 2 }])
  })

  it('带 startDate 的计划导入后行程本 startDate 保留', async () => {
    const deps = makeDeps()
    const plan = await seededPlan(deps.repo, [{ dayIndex: 1, items: [{ type: 'point', pointId: 'pt-a', title: 'A' }] }])
    await deps.repo.updateMeta(plan.id, { startDate: new Date('2026-10-03T00:00:00.000Z') })

    const res = await createExportRouteBookHandler(deps).POST(plan.id)
    expect(res.status).toBe(201)
    const book = deps.store.books[0]!
    expect(book.startDate).toEqual(new Date('2026-10-03T00:00:00.000Z'))
    expect(book.metadata).toEqual({ sourcePlanId: plan.id, startDate: '2026-10-03T00:00:00.000Z' })
  })
})
