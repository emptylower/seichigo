import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/db/prisma', () => {
  const tx = {
    routeBook: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(),
      delete: vi.fn(),
    },
    routeBookDay: {
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(),
    },
    routeBookItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 0),
    },
    routeBookPlace: {
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 0),
    },
    routeBookLodging: {
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    anitabiPoint: {
      findUnique: vi.fn(),
    },
  }
  const prisma = {
    $transaction: vi.fn(async (arg: unknown) => (arg as (t: unknown) => Promise<unknown>)(tx)),
    __txForTest: tx,
  }
  return { prisma }
})

import { prisma } from '@/lib/db/prisma'
import { PrismaRouteBookRepo } from '@/lib/routeBook/repoPrisma'
import { RouteBookRuleError } from '@/lib/routeBook/repo'

const mocked = prisma as unknown as {
  $transaction: Mock
  __txForTest: {
    routeBook: { findFirst: Mock; updateMany: Mock }
    routeBookDay: { findFirst: Mock }
    routeBookItem: { findMany: Mock; update: Mock; create: Mock }
    anitabiPoint: { findUnique: Mock }
  }
}

const UPDATED_AT = new Date('2026-09-23T08:00:00.000Z')

const BOOK_ROW = {
  id: 'rb-1',
  userId: 'u1',
  title: '本',
  status: 'draft',
  metadata: null,
  startDate: null,
  dayCount: 1,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: UPDATED_AT,
}

function itemRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'i1',
    routeBookId: 'rb-1',
    dayId: 'd1',
    sortOrder: 0,
    kind: 'point',
    pointId: 'p1',
    placeId: null,
    title: null,
    note: null,
    timeStart: null,
    timeEnd: null,
    locked: false,
    icon: null,
    color: null,
    legMode: null,
    payload: null,
    createdAt: new Date('2026-09-02T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.$transaction.mockImplementation(async (arg: unknown) => (arg as (t: unknown) => Promise<unknown>)(mocked.__txForTest))
  mocked.__txForTest.routeBook.findFirst.mockResolvedValue(BOOK_ROW)
})

describe('PrismaRouteBookRepo.reorderItems 乐观锁', () => {
  it('touch 用 updateMany 按当前 updatedAt 条件推进，count>0 才提交', async () => {
    mocked.__txForTest.routeBookItem.findMany.mockResolvedValue([
      itemRow({ id: 'a', sortOrder: 0 }),
      itemRow({ id: 'b', sortOrder: 1 }),
    ])

    const repo = new PrismaRouteBookRepo({ now: () => new Date('2026-09-23T09:00:00.000Z') })
    const res = await repo.reorderItems('rb-1', 'u1', 'd1', ['b', 'a'], UPDATED_AT)

    expect(mocked.__txForTest.routeBook.updateMany).toHaveBeenCalledWith({
      where: { id: 'rb-1', userId: 'u1', updatedAt: UPDATED_AT },
      data: { updatedAt: new Date('2026-09-23T09:00:00.000Z') },
    })
    expect(res.updatedAt).toEqual(new Date('2026-09-23T09:00:00.000Z'))

    // 新顺序写回：b→0、a→1
    const updateArgs = mocked.__txForTest.routeBookItem.update.mock.calls.map((call) => call[0])
    expect(updateArgs).toContainEqual({ where: { id: 'b' }, data: { dayId: 'd1', sortOrder: 0 } })
    expect(updateArgs).toContainEqual({ where: { id: 'a' }, data: { dayId: 'd1', sortOrder: 1 } })
  })

  it('expectedUpdatedAt 不匹配 → stale，不做任何写入', async () => {
    const repo = new PrismaRouteBookRepo()
    await expect(repo.reorderItems('rb-1', 'u1', 'd1', ['a'], new Date(0))).rejects.toMatchObject({
      reason: 'stale',
    })
    expect(mocked.__txForTest.routeBook.updateMany).not.toHaveBeenCalled()
    expect(mocked.__txForTest.routeBookItem.update).not.toHaveBeenCalled()
  })

  it('updateMany count===0（并发覆盖）→ stale', async () => {
    mocked.__txForTest.routeBookItem.findMany.mockResolvedValue([itemRow({ id: 'a' })])
    mocked.__txForTest.routeBook.updateMany.mockResolvedValue({ count: 0 })

    const repo = new PrismaRouteBookRepo()
    const promise = repo.reorderItems('rb-1', 'u1', 'd1', ['a'])
    await expect(promise).rejects.toBeInstanceOf(RouteBookRuleError)
    await expect(promise).rejects.toMatchObject({ reason: 'stale' })
  })
})

describe('PrismaRouteBookRepo.createItem', () => {
  it('pointId 不存在 → invalid（点位不存在），不落到外键 500', async () => {
    mocked.__txForTest.routeBookDay.findFirst.mockResolvedValue({ id: 'd1', routeBookId: 'rb-1' })
    mocked.__txForTest.anitabiPoint.findUnique.mockResolvedValue(null)

    const repo = new PrismaRouteBookRepo()
    await expect(repo.createItem('rb-1', 'u1', { dayId: 'd1', kind: 'point', pointId: 'ghost' })).rejects.toMatchObject({
      reason: 'invalid',
      message: '点位不存在',
    })
    expect(mocked.__txForTest.routeBookItem.create).not.toHaveBeenCalled()
  })

  it('dayId 不属于本行程本 → invalid', async () => {
    mocked.__txForTest.routeBookDay.findFirst.mockResolvedValue(null)

    const repo = new PrismaRouteBookRepo()
    await expect(
      repo.createItem('rb-1', 'u1', { dayId: '别家的天', kind: 'note', title: 'x' })
    ).rejects.toMatchObject({ reason: 'invalid' })
    expect(mocked.__txForTest.routeBookItem.create).not.toHaveBeenCalled()
  })
})
