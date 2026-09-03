import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

type TxSpies = {
  $queryRaw: Mock
  tripPlanDay: { deleteMany: Mock; createMany: Mock; create: Mock }
  tripPlanItem: { createMany: Mock; create: Mock }
  tripPlan: { update: Mock; updateMany: Mock; findUnique: Mock }
}

vi.mock('@/lib/db/prisma', () => {
  const tx = {
    $queryRaw: vi.fn(async () => [{ agentRunToken: 'tok-1' }]),
    tripPlanDay: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({})),
    },
    tripPlanItem: {
      createMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({})),
    },
    tripPlan: {
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => null),
    },
  }
  const prisma = {
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? arg : (arg as (t: unknown) => Promise<unknown>)(tx),
    ),
    __txForTest: tx,
    tripPlanDay: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({})),
    },
    tripPlanItem: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    tripPlan: {
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => null),
    },
  }
  return { prisma }
})

import { prisma } from '@/lib/db/prisma'
import { PrismaTripPlanRepo } from '@/lib/tripPlan/repoPrisma'
import type { TripPlanDayInput } from '@/lib/tripPlan/repo'

const mocked = prisma as unknown as {
  $transaction: Mock
  __txForTest: TxSpies
  tripPlanDay: { deleteMany: Mock; createMany: Mock; create: Mock }
  tripPlanItem: { createMany: Mock }
  tripPlan: { update: Mock; updateMany: Mock; findUnique: Mock }
}

const PLAN_ROW = {
  id: 'plan-1',
  userId: 'u1',
  title: 't',
  status: 'draft',
  startDate: null,
  dayCount: 1,
  bangumiIds: [],
  preferences: null,
  stage: null,
  agentRunToken: null,
  agentBusyUntil: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  days: [
    {
      id: 'd1',
      planId: 'plan-1',
      dayIndex: 1,
      date: null,
      citySlug: null,
      summary: null,
      items: [
        {
          id: 'i1',
          dayId: 'd1',
          sortOrder: 0,
          type: 'point',
          pointId: null,
          timeHint: null,
          title: '宇治桥',
          note: null,
          reason: null,
          payload: null,
          point: null,
        },
      ],
    },
  ],
}

function makeDays(dayCount: number, itemsPerDay: number): TripPlanDayInput[] {
  return Array.from({ length: dayCount }, (_, d) => ({
    dayIndex: d + 1,
    citySlug: 'kyoto',
    summary: `第 ${d + 1} 天`,
    items: Array.from({ length: itemsPerDay }, (_, i) => ({
      type: 'free' as const,
      title: `条目 ${d + 1}-${i + 1}`,
      note: '备注',
      reason: '理由',
    })),
  }))
}

type DayRow = { id: string; planId: string; dayIndex: number; citySlug: string | null; summary: string | null }
type ItemRow = { dayId: string; sortOrder: number; type: string; title: string }

function dayRowsFromTx(): DayRow[] {
  return mocked.__txForTest.tripPlanDay.createMany.mock.calls[0][0].data as DayRow[]
}

function itemRowsFromTx(): ItemRow[] {
  return mocked.__txForTest.tripPlanItem.createMany.mock.calls[0][0].data as ItemRow[]
}

/** 事务内执行过的语句总数（含锁行查询），用于断言写入路径与数据规模解耦 */
function txStatementCount(): number {
  const tx = mocked.__txForTest
  return (
    tx.$queryRaw.mock.calls.length +
    tx.tripPlanDay.deleteMany.mock.calls.length +
    tx.tripPlanDay.createMany.mock.calls.length +
    tx.tripPlanDay.create.mock.calls.length +
    tx.tripPlanItem.createMany.mock.calls.length +
    tx.tripPlanItem.create.mock.calls.length +
    tx.tripPlan.update.mock.calls.length +
    tx.tripPlan.findUnique.mock.calls.length
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? arg : (arg as (t: unknown) => Promise<unknown>)(mocked.__txForTest),
  )
  mocked.__txForTest.$queryRaw.mockResolvedValue([{ agentRunToken: 'tok-1' }])
  mocked.tripPlan.findUnique.mockResolvedValue(PLAN_ROW)
})

describe('PrismaTripPlanRepo.replaceDaysIfActive 批量写入（事务超时修复）', () => {
  it('事务带显式 maxWait/timeout，不再依赖 Prisma 默认 5000ms', async () => {
    const repo = new PrismaTripPlanRepo()
    await repo.replaceDaysIfActive('plan-1', 'tok-1', makeDays(7, 8))
    expect(mocked.$transaction).toHaveBeenCalledTimes(1)
    const options = mocked.$transaction.mock.calls[0][1] as { maxWait?: number; timeout?: number } | undefined
    expect(options?.maxWait).toBe(10_000)
    expect(options?.timeout).toBe(15_000)
  })

  it('用 createMany 批量写入天与条目，禁止逐天/逐条串行 create', async () => {
    const repo = new PrismaTripPlanRepo()
    await repo.replaceDaysIfActive('plan-1', 'tok-1', makeDays(7, 8))
    const tx = mocked.__txForTest
    expect(tx.tripPlanDay.create).not.toHaveBeenCalled()
    expect(tx.tripPlanItem.create).not.toHaveBeenCalled()
    expect(tx.tripPlanDay.deleteMany).toHaveBeenCalledTimes(1)
    expect(tx.tripPlanDay.deleteMany).toHaveBeenCalledWith({ where: { planId: 'plan-1' } })
    expect(tx.tripPlanDay.createMany).toHaveBeenCalledTimes(1)
    expect(tx.tripPlanItem.createMany).toHaveBeenCalledTimes(1)
  })

  it('天行带应用层生成的唯一 id，条目行 dayId 外键指向所属天且 sortOrder 按天重置', async () => {
    const repo = new PrismaTripPlanRepo()
    await repo.replaceDaysIfActive('plan-1', 'tok-1', makeDays(7, 8))

    const dayRows = dayRowsFromTx()
    expect(dayRows).toHaveLength(7)
    const ids = dayRows.map((r) => r.id)
    expect(new Set(ids).size).toBe(7)
    dayRows.forEach((row, i) => {
      expect(row.planId).toBe('plan-1')
      expect(row.dayIndex).toBe(i + 1)
      expect(row.citySlug).toBe('kyoto')
      expect(row.summary).toBe(`第 ${i + 1} 天`)
    })

    const itemRows = itemRowsFromTx()
    expect(itemRows).toHaveLength(56)
    for (let d = 0; d < 7; d++) {
      const chunk = itemRows.slice(d * 8, d * 8 + 8)
      expect(chunk.map((r) => r.dayId)).toEqual(Array.from({ length: 8 }, () => dayRows[d].id))
      expect(chunk.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
      chunk.forEach((row) => {
        expect(row.type).toBe('free')
        expect(row.title).toContain(`${d + 1}-`)
      })
    }
  })

  it('事务内语句数与数据规模无关：1 天 2 条与 7 天 50 条相同', async () => {
    const repo = new PrismaTripPlanRepo()
    await repo.replaceDaysIfActive('plan-1', 'tok-1', makeDays(1, 2))
    const small = txStatementCount()
    // 清掉调用记录再跑一次大规模输入，比较两轮各自的语句数
    vi.clearAllMocks()
    mocked.$transaction.mockImplementation(async (arg: unknown) =>
      Array.isArray(arg) ? arg : (arg as (t: unknown) => Promise<unknown>)(mocked.__txForTest),
    )
    mocked.__txForTest.$queryRaw.mockResolvedValue([{ agentRunToken: 'tok-1' }])
    mocked.tripPlan.findUnique.mockResolvedValue(PLAN_ROW)
    await repo.replaceDaysIfActive('plan-1', 'tok-1', makeDays(7, 50))
    const large = txStatementCount()
    expect(small).toBe(5)
    expect(large).toBe(5)
  })

  it('全量回读移到事务提交之后，事务内不做 include 大读', async () => {
    const repo = new PrismaTripPlanRepo()
    const out = await repo.replaceDaysIfActive('plan-1', 'tok-1', makeDays(2, 3))
    expect(mocked.__txForTest.tripPlan.findUnique).not.toHaveBeenCalled()
    expect(mocked.tripPlan.findUnique).toHaveBeenCalledTimes(1)
    expect(out?.days[0].items[0].title).toBe('宇治桥')
  })

  it('token 不匹配时整体 no-op，不写也不回读', async () => {
    mocked.__txForTest.$queryRaw.mockResolvedValue([{ agentRunToken: 'other-token' }])
    const repo = new PrismaTripPlanRepo()
    const out = await repo.replaceDaysIfActive('plan-1', 'tok-1', makeDays(2, 2))
    expect(out).toBeNull()
    expect(mocked.__txForTest.tripPlanDay.deleteMany).not.toHaveBeenCalled()
    expect(mocked.__txForTest.tripPlanDay.createMany).not.toHaveBeenCalled()
    expect(mocked.tripPlan.findUnique).not.toHaveBeenCalled()
  })

  it('空天列表只清旧数据，不发起 createMany', async () => {
    const repo = new PrismaTripPlanRepo()
    await repo.replaceDaysIfActive('plan-1', 'tok-1', [])
    expect(mocked.__txForTest.tripPlanDay.deleteMany).toHaveBeenCalledTimes(1)
    expect(mocked.__txForTest.tripPlanDay.createMany).not.toHaveBeenCalled()
    expect(mocked.__txForTest.tripPlanItem.createMany).not.toHaveBeenCalled()
  })

  it('有天但零条目时跳过条目批量写入', async () => {
    const repo = new PrismaTripPlanRepo()
    await repo.replaceDaysIfActive('plan-1', 'tok-1', [{ dayIndex: 1, items: [] }])
    expect(mocked.__txForTest.tripPlanDay.createMany).toHaveBeenCalledTimes(1)
    expect(dayRowsFromTx()).toHaveLength(1)
    expect(mocked.__txForTest.tripPlanItem.createMany).not.toHaveBeenCalled()
  })

  it('payload 为 null/undefined 时省略字段，不做 JsonNull 区分写入', async () => {
    const repo = new PrismaTripPlanRepo()
    await repo.replaceDaysIfActive('plan-1', 'tok-1', [
      {
        dayIndex: 1,
        items: [
          { type: 'free', title: '无 payload' },
          { type: 'transit', title: '有 payload', payload: { mode: 'walk', durationMin: 5, distanceKm: 0.4 } },
        ],
      },
    ])
    const rows = itemRowsFromTx()
    expect('payload' in rows[0]).toBe(false)
    expect((rows[1] as unknown as { payload: unknown }).payload).toEqual({ mode: 'walk', durationMin: 5, distanceKm: 0.4 })
  })
})

describe('PrismaTripPlanRepo.replaceDays（无栅栏版）批量写入', () => {
  it('数组事务同样走 createMany，不逐天 create', async () => {
    const repo = new PrismaTripPlanRepo()
    await repo.replaceDays('plan-1', makeDays(3, 4))
    expect(mocked.tripPlanDay.create).not.toHaveBeenCalled()
    expect(mocked.tripPlanDay.deleteMany).toHaveBeenCalledTimes(1)
    expect(mocked.tripPlanDay.createMany).toHaveBeenCalledTimes(1)
    expect(mocked.tripPlanItem.createMany).toHaveBeenCalledTimes(1)
    expect(mocked.tripPlan.update).toHaveBeenCalledTimes(1)
    expect(mocked.tripPlan.findUnique).toHaveBeenCalledTimes(1)
    const dayRows = mocked.tripPlanDay.createMany.mock.calls[0][0].data as DayRow[]
    expect(dayRows).toHaveLength(3)
    const itemRows = mocked.tripPlanItem.createMany.mock.calls[0][0].data as ItemRow[]
    expect(itemRows).toHaveLength(12)
    expect(itemRows.slice(0, 4).map((r) => r.dayId)).toEqual(Array.from({ length: 4 }, () => dayRows[0].id))
  })
})

describe('PrismaTripPlanRepo.replaceDaysIfUnchanged（S2 乐观版本守卫）', () => {
  it('版本匹配：同一事务内先条件 updateMany 推进 updatedAt，count>0 才执行与 replaceDays 相同的批量写入', async () => {
    const repo = new PrismaTripPlanRepo()
    const expected = new Date('2026-09-03T00:00:00.000Z')
    const out = await repo.replaceDaysIfUnchanged('plan-1', expected, makeDays(2, 3))

    const tx = mocked.__txForTest
    expect(tx.tripPlan.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.tripPlan.updateMany).toHaveBeenCalledWith({
      where: { id: 'plan-1', updatedAt: expected },
      data: { updatedAt: expect.any(Date) },
    })
    // 守卫先于删除执行：版本不匹配时绝不能删任何天
    expect(tx.tripPlan.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.tripPlanDay.deleteMany.mock.invocationCallOrder[0],
    )
    expect(tx.tripPlanDay.deleteMany).toHaveBeenCalledTimes(1)
    expect(tx.tripPlanDay.createMany).toHaveBeenCalledTimes(1)
    expect(tx.tripPlanItem.createMany).toHaveBeenCalledTimes(1)
    expect(mocked.tripPlan.findUnique).toHaveBeenCalledTimes(1) // 提交后才回读
    // 回读来自 PLAN_ROW mock（天数形状与写入规模无关），只断言非空
    expect(out).not.toBeNull()
  })

  it('版本不匹配（count === 0）：整体 no-op 返回 null，不删不写不回读', async () => {
    mocked.__txForTest.tripPlan.updateMany.mockResolvedValueOnce({ count: 0 })
    const repo = new PrismaTripPlanRepo()
    const out = await repo.replaceDaysIfUnchanged('plan-1', new Date(0), makeDays(1, 1))

    expect(out).toBeNull()
    expect(mocked.__txForTest.tripPlanDay.deleteMany).not.toHaveBeenCalled()
    expect(mocked.__txForTest.tripPlanDay.createMany).not.toHaveBeenCalled()
    expect(mocked.__txForTest.tripPlanItem.createMany).not.toHaveBeenCalled()
    expect(mocked.tripPlan.findUnique).not.toHaveBeenCalled()
  })
})
