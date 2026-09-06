import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanDayInput } from '@/lib/tripPlan/repo'
import { planNeedsContinuation, runEnrichContinuation } from '@/lib/planAgent/enrichContinuation'
import type { PointFinder } from '@/lib/planAgent/points'
import type { NearbyRestaurant, NearbySearchResult } from '@/lib/googlePlaces/nearby'
import { emptyEnrichReport } from '@/lib/planAgent/enrich/types'
import type { TravelResult } from '@/lib/directions/googleClient'
import { GOOGLE_PRICES_MICROS } from '@/lib/billing/priceTable'

/**
 * R4 补齐续跑：run 结束后若仍有预算耗尽类 skipped 或 restaurantPending 条目，
 * 服务端后台不叫模型再跑补齐脚本。sleep 注入为立即返回（不真实等 61s）。
 */

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
  async getPointsByIds(ids) {
    const all = [
      { id: 'p1', lat: 34.8892, lng: 135.8075 },
      { id: 'p2', lat: 34.8963, lng: 135.8123 },
    ]
    return all.filter((p) => ids.includes(p.id))
  },
}

function restaurant(i: number): NearbyRestaurant {
  return {
    provider: 'google',
    placeId: `ChIJ_cont_${i}`,
    name: `续跑餐厅${i}号`,
    address: null,
    lat: 34.89 + i * 0.001,
    lng: 135.81,
    mapsUri: `https://www.google.com/maps/place/?q=place_id:ChIJ_cont_${i}`,
    photo: null,
    fetchedAt: '2026-09-03T00:00:00.000Z',
    rating: 4.5,
    userRatingsTotal: 100,
    priceLevel: 2,
  }
}

function seedDays(): TripPlanDayInput[] {
  return [
    {
      dayIndex: 1,
      date: new Date('2026-10-01T00:00:00.000Z'),
      items: [
        { type: 'point', pointId: 'p1', title: '宇治桥' },
        { type: 'meal', title: '午餐', payload: { mealSlot: 'lunch', restaurantPending: true } },
        { type: 'point', pointId: 'p2', title: '大吉山' },
        { type: 'meal', title: '晚餐', payload: { mealSlot: 'dinner', restaurantPending: true } },
      ],
    },
  ]
}

async function setup() {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  await repo.replaceDays(plan.id, seedDays())
  return { repo, planId: plan.id }
}

const immediateSleep = async () => {}

describe('planNeedsContinuation', () => {
  it('预算耗尽类 skipped（中文/英文）与 restaurantPending 条目都判 true', () => {
    const budgetSkip = emptyEnrichReport()
    budgetSkip.skipped.push({ enricher: 'restaurant', itemTitle: '午餐', reason: '本次保存的 Google 调用预算已用完' })
    expect(planNeedsContinuation(budgetSkip)).toBe(true)

    const english = emptyEnrichReport()
    english.skipped.push({ enricher: 'place', itemTitle: 'x', reason: 'budget exhausted for places' })
    expect(planNeedsContinuation(english)).toBe(true)

    const clean = emptyEnrichReport()
    expect(planNeedsContinuation(clean)).toBe(false)
    expect(planNeedsContinuation(null)).toBe(false)

    const pendingDays = [{ items: [{ type: 'meal', payload: { restaurantPending: true } }] }]
    expect(planNeedsContinuation(null, pendingDays)).toBe(true)
    expect(planNeedsContinuation(null, [{ items: [{ type: 'meal', payload: {} }] }])).toBe(false)
  })
})

describe('runEnrichContinuation（内存 repo + 内存装配）', () => {
  it('场景 A：2 餐 restaurantPending、注入可用 findRestaurants → 一轮后两餐都有 place 且写一条 stage=enrich 日志', async () => {
    const { repo, planId } = await setup()
    const findRestaurants = vi.fn(async () => ({ ok: true as const, restaurants: [restaurant(0), restaurant(1)] }))

    await runEnrichContinuation({
      planId,
      runToken: 'run-token-a',
      repo,
      points: finder,
      deps: { findRestaurants },
      sleep: immediateSleep,
    })

    const plan = await repo.getPlan(planId)
    const meals = plan?.days[0]?.items.filter((i) => i.type === 'meal') ?? []
    expect(meals).toHaveLength(2)
    for (const meal of meals) {
      expect((meal.payload as Record<string, unknown>)?.place).toMatchObject({ provider: 'google' })
      expect((meal.payload as Record<string, unknown>)?.restaurantPending).toBeUndefined()
    }
    // 两餐不同中心（p1/p2 各自搜索一次）；S4：同一天按 placeId 去重，
    // 两餐分别拿到第 1、2 名（不再重复推荐同一家）
    expect(findRestaurants).toHaveBeenCalledTimes(2)
    const placeIds = meals.map((m) => ((m.payload as Record<string, unknown>).place as Record<string, unknown>).placeId)
    expect(placeIds).toEqual(['ChIJ_cont_0', 'ChIJ_cont_1'])
    // S5：续跑写回保留 day.date 原值
    expect(plan?.days[0]?.date?.toISOString()).toBe('2026-10-01T00:00:00.000Z')

    const logs = await repo.listRunLogs(planId)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ stage: 'enrich', runToken: 'run-token-a', turnIndex: 1 })
    expect((logs[0]!.toolCalls as Array<{ name: string }>[])[0]).toMatchObject({ name: 'enrich_continuation' })
    expect((logs[0]!.enrichReport as { applied: { restaurant: number } }).applied.restaurant).toBe(2)
  })

  it('场景 B：新 run 已接管（busy 位被别的 token 持有）→ 不改数据、不写日志', async () => {
    const { repo, planId } = await setup()
    const begin = await repo.beginAgentRun({
      planId,
      userId: 'u1',
      content: { role: 'user', content: '新消息' },
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
    })
    expect(begin.status).toBe('ok')
    const findRestaurants = vi.fn(async () => ({ ok: true as const, restaurants: [restaurant(0)] }))

    await runEnrichContinuation({
      planId,
      runToken: 'stale-token',
      repo,
      points: finder,
      deps: { findRestaurants },
      sleep: immediateSleep,
    })

    expect(findRestaurants).not.toHaveBeenCalled()
    const plan = await repo.getPlan(planId)
    const meals = plan?.days[0]?.items.filter((i) => i.type === 'meal') ?? []
    for (const meal of meals) {
      expect((meal.payload as Record<string, unknown>)?.place).toBeUndefined()
      expect((meal.payload as Record<string, unknown>)?.restaurantPending).toBe(true)
    }
    expect(await repo.listRunLogs(planId)).toHaveLength(0)
  })

  it('场景 C：第一轮仍无餐厅、第二轮补齐 → 恰好两条日志', async () => {
    const { repo, planId } = await setup()
    // 同中心（两餐都在 p1 之后）→ 每轮只搜 1 次；第一轮空、第二轮有
    await repo.replaceDays(planId, [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥' },
          { type: 'meal', title: '午餐', payload: { mealSlot: 'lunch', restaurantPending: true } },
          { type: 'meal', title: '晚餐', payload: { mealSlot: 'dinner', restaurantPending: true } },
        ],
      },
    ])
    let calls = 0
    const findRestaurants = vi.fn(async (): Promise<NearbySearchResult> => {
      calls += 1
      return calls === 1 ? { ok: true, restaurants: [] } : { ok: true, restaurants: [restaurant(0), restaurant(1)] }
    })

    await runEnrichContinuation({
      planId,
      runToken: 'run-token-c',
      repo,
      points: finder,
      deps: { findRestaurants },
      sleep: immediateSleep,
    })

    expect(findRestaurants).toHaveBeenCalledTimes(2)
    const plan = await repo.getPlan(planId)
    const meals = plan?.days[0]?.items.filter((i) => i.type === 'meal') ?? []
    for (const meal of meals) {
      expect((meal.payload as Record<string, unknown>)?.place).toBeDefined()
    }
    const logs = await repo.listRunLogs(planId)
    expect(logs).toHaveLength(2)
    expect(logs.map((l) => l.stage)).toEqual(['enrich', 'enrich'])
    expect(logs.map((l) => l.turnIndex)).toEqual([1, 2])
  })

  it('S2：enrich 期间另一次保存改了 updatedAt → 版本守卫拒绝写回，不覆盖并发保存、不写日志', async () => {
    const { repo, planId } = await setup()
    const findRestaurants = vi.fn(async () => {
      // enrich 执行中：另一个并发保存整份替换了天数（updatedAt 前进）
      await repo.replaceDays(planId, [{ dayIndex: 1, items: [{ type: 'free', title: '并发保存' }] }])
      return { ok: true as const, restaurants: [restaurant(0), restaurant(1)] }
    })

    await runEnrichContinuation({
      planId,
      runToken: 'run-token-s2a',
      repo,
      points: finder,
      deps: { findRestaurants },
      sleep: immediateSleep,
    })

    const plan = await repo.getPlan(planId)
    // 续跑基于轮首快照算出的天数绝不能覆盖并发保存的结果
    expect(plan?.days[0]?.items.map((i) => i.title)).toEqual(['并发保存'])
    expect(await repo.listRunLogs(planId)).toHaveLength(0)
  })

  it('S2：sleep 期间 runToken 被新 run 换掉 → 不做任何写回、不写日志', async () => {
    const { repo, planId } = await setup()
    const findRestaurants = vi.fn(async () => ({ ok: true as const, restaurants: [restaurant(0)] }))
    const sleepDuringTakeover = async () => {
      const begin = await repo.beginAgentRun({
        planId,
        userId: 'u1',
        content: { role: 'user', content: '新消息' },
        since: new Date(0),
        limit: 10,
        busyTtlMs: 60_000,
      })
      expect(begin.status).toBe('ok')
    }

    await runEnrichContinuation({
      planId,
      runToken: 'run-token-s2b',
      repo,
      points: finder,
      deps: { findRestaurants },
      sleep: sleepDuringTakeover,
    })

    expect(findRestaurants).not.toHaveBeenCalled()
    const plan = await repo.getPlan(planId)
    const meals = plan?.days[0]?.items.filter((i) => i.type === 'meal') ?? []
    for (const meal of meals) {
      expect((meal.payload as Record<string, unknown>)?.place).toBeUndefined()
      expect((meal.payload as Record<string, unknown>)?.restaurantPending).toBe(true)
    }
    expect(await repo.listRunLogs(planId)).toHaveLength(0)
  })

  it('S7：已有同毫秒乱序日志时 turnIndex 取最大值 +1（不取最后一条）', async () => {
    const { repo, planId } = await setup()
    // 同毫秒内先后写入 turnIndex 5 与 2：按 createdAt 取"最后一条"会拿到 2，
    // 同毫秒并列时排序并不稳定，必须取最大值
    await repo.appendRunLog({ planId, runToken: null, turnIndex: 5, stage: 'works', enrichReport: null, gateReport: null, toolCalls: null, modelUsage: null, durationMs: 1 })
    await repo.appendRunLog({ planId, runToken: null, turnIndex: 2, stage: 'enrich', enrichReport: null, gateReport: null, toolCalls: null, modelUsage: null, durationMs: 1 })
    const findRestaurants = vi.fn(async () => ({ ok: true as const, restaurants: [restaurant(0), restaurant(1)] }))

    await runEnrichContinuation({
      planId,
      runToken: 'run-token-s7',
      repo,
      points: finder,
      deps: { findRestaurants },
      sleep: immediateSleep,
    })

    const logs = await repo.listRunLogs(planId)
    expect(logs).toHaveLength(3)
    expect(logs[2]!.turnIndex).toBe(6)
  })

  it('F3：续跑补齐的 Google 调用计入 enrich 日志（directions 计数与成本）', async () => {
    const { repo, planId } = await setup()
    // p1/p2 两个有坐标的相邻点位 → transport enricher 发起一次真实 Directions 外呼
    const travel = vi.fn(async (): Promise<TravelResult> => ({
      ok: true,
      mode: 'walking',
      legs: [],
      durationSeconds: 600,
      distanceMeters: 800,
      transfers: 0,
      walkSeconds: 600,
      transitSeconds: 0,
      polyline: [],
    }))

    await runEnrichContinuation({
      planId,
      runToken: 'run-token-f3',
      repo,
      points: finder,
      deps: { travel },
      sleep: immediateSleep,
    })

    expect(travel).toHaveBeenCalledTimes(1)
    const logs = await repo.listRunLogs(planId)
    // 两餐无 findRestaurants 可用 → 第二轮 pass 继续跑（共 2 条日志）；
    // directions 只发生在第一轮（第二轮交通已合格，不再外呼）
    expect(logs).toHaveLength(2)
    const usage = logs[0]!.modelUsage as
      | { calls?: { directions: number }; costMicros?: { google: number; model: number } }
      | null
    expect(usage?.calls?.directions).toBe(1)
    expect(usage?.costMicros?.google).toBe(GOOGLE_PRICES_MICROS.directions)
    expect(usage?.costMicros?.model).toBe(0)
    const secondUsage = logs[1]!.modelUsage as { calls?: { directions: number } } | null
    expect(secondUsage?.calls?.directions).toBe(0)
  })

  it('续跑异常只 warn 不抛（repo 抛错也不冒泡）', async () => {
    const { repo, planId } = await setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const brokenRepo = new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === 'getPlan') {
          return async () => {
            throw new Error('db down')
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    try {
      await expect(
        runEnrichContinuation({
          planId,
          runToken: null,
          repo: brokenRepo,
          points: finder,
          deps: {},
          sleep: immediateSleep,
        }),
      ).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
