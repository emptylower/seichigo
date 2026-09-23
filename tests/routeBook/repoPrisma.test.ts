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

const mocked = prisma as unknown as {
  $transaction: Mock
  __txForTest: {
    routeBook: { findFirst: Mock; update: Mock; updateMany: Mock }
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

describe('PrismaRouteBookRepo.reorderItems 先锁行再写入', () => {
  it('事务开头用 routeBook.update 锁行推进 updatedAt；只更新 dayId/sortOrder 变化的行', async () => {
    mocked.__txForTest.routeBookDay.findFirst.mockResolvedValue({ id: 'd1', routeBookId: 'rb-1' })
    mocked.__txForTest.routeBookItem.findMany.mockImplementation(async (arg: unknown) => {
      const where = (arg as { where?: { dayId?: string | null } }).where
      if (where?.dayId === null) return []
      return [
        itemRow({ id: 'a', sortOrder: 0 }),
        itemRow({ id: 'b', sortOrder: 1 }),
      ]
    })

    const repo = new PrismaRouteBookRepo({ now: () => new Date('2026-09-23T09:00:00.000Z') })
    const res = await repo.reorderItems('rb-1', 'u1', 'd1', ['b', 'a'])

    expect(mocked.__txForTest.routeBook.update).toHaveBeenCalledWith({
      where: { id: 'rb-1', userId: 'u1' },
      data: { updatedAt: new Date('2026-09-23T09:00:00.000Z') },
    })
    expect(res.bookUpdatedAt).toEqual(new Date('2026-09-23T09:00:00.000Z'))

    // 新顺序写回：b→0、a→1
    const updateArgs = mocked.__txForTest.routeBookItem.update.mock.calls.map((call) => call[0])
    expect(updateArgs).toContainEqual({ where: { id: 'b' }, data: { dayId: 'd1', sortOrder: 0 } })
    expect(updateArgs).toContainEqual({ where: { id: 'a' }, data: { dayId: 'd1', sortOrder: 1 } })
  })

  it('顺序未变的行不重写（写放大收敛）', async () => {
    mocked.__txForTest.routeBookDay.findFirst.mockResolvedValue({ id: 'd1', routeBookId: 'rb-1' })
    mocked.__txForTest.routeBookItem.findMany.mockImplementation(async (arg: unknown) => {
      const where = (arg as { where?: { dayId?: string | null } }).where
      if (where?.dayId === null) return []
      return [itemRow({ id: 'a', sortOrder: 0 })]
    })

    const repo = new PrismaRouteBookRepo()
    await repo.reorderItems('rb-1', 'u1', 'd1', ['a'])
    expect(mocked.__txForTest.routeBookItem.update).not.toHaveBeenCalled()
  })

  it('锁行时 userId 不匹配（P2025）→ not_found', async () => {
    mocked.__txForTest.routeBook.update.mockRejectedValueOnce(Object.assign(new Error('record not found'), { code: 'P2025' }))

    const repo = new PrismaRouteBookRepo()
    await expect(repo.reorderItems('rb-1', 'u2', 'd1', ['a'])).rejects.toMatchObject({ reason: 'not_found' })
    expect(mocked.__txForTest.routeBookItem.update).not.toHaveBeenCalled()
  })

  it('目标 dayId 不属于本行程本 → invalid，不做任何条目写入', async () => {
    mocked.__txForTest.routeBookDay.findFirst.mockResolvedValue(null)

    const repo = new PrismaRouteBookRepo()
    await expect(repo.reorderItems('rb-1', 'u1', '别家的天', ['a'])).rejects.toMatchObject({
      reason: 'invalid',
      message: '目标天不存在',
    })
    expect(mocked.__txForTest.routeBookItem.update).not.toHaveBeenCalled()
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
