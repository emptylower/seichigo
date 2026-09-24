import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'

type CacheRow = { key: string; payload: Prisma.JsonValue; expiresAt: Date }

// 文件级替换 prisma：内存表实现 routeLegCache（每条测试用唯一 key，免重置）
vi.mock('@/lib/db/prisma', () => {
  const rows = new Map<string, CacheRow>()
  const prisma = {
    routeLegCache: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
      findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        [...rows.values()].filter((row) => where.key.in.includes(row.key)),
      ),
      delete: vi.fn(async ({ where }: { where: { key: string } }) => {
        rows.delete(where.key)
        return null
      }),
      deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => {
        rows.delete(where.key)
        return { count: 1 }
      }),
      upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: CacheRow }) => {
        rows.set(where.key, create)
        return create
      }),
    },
  }
  return { prisma }
})

import {
  getCachedLegs,
  getCachedRoutePayload,
  routeLegCacheKey,
  setCachedLeg,
  setCachedRoutePayload,
} from '@/lib/routeBook/legCache'
import { prisma } from '@/lib/db/prisma'

describe('legCache', () => {
  it('routeLegCacheKey 是 sha256 hex', () => {
    expect(routeLegCacheKey('leg|walking|35.00000,135.00000|35.00270,135.00000')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('setCachedRoutePayload upsert：新写 + 覆盖；getCachedRoutePayload 命中', async () => {
    const key = routeLegCacheKey('t-hit')
    expect(await getCachedRoutePayload(key)).toBeNull()

    await setCachedRoutePayload(key, { a: 1 } as Prisma.InputJsonValue)
    expect(await getCachedRoutePayload(key)).toEqual({ a: 1 })

    await setCachedRoutePayload(key, { a: 2 } as Prisma.InputJsonValue)
    expect(await getCachedRoutePayload(key)).toEqual({ a: 2 })
  })

  it('过期条目按未命中并异步清理', async () => {
    const key = routeLegCacheKey('t-expired')
    await setCachedRoutePayload(key, { a: 1 } as Prisma.InputJsonValue, 0)
    // ttl=0 天 → 已过期
    expect(await getCachedRoutePayload(key)).toBeNull()
    await vi.waitFor(() => {
      expect(prisma.routeLegCache.delete).toHaveBeenCalled()
    })
  })

  it('setCachedLeg 与 getCachedLegs 批量读：命中进 Map、未命中不在 Map、空数组不发查询', async () => {
    const keyA = routeLegCacheKey('t-batch-a')
    const keyB = routeLegCacheKey('t-batch-b')
    const keyC = routeLegCacheKey('t-batch-c')
    await setCachedLeg(keyA, { leg: 'a' } as Prisma.InputJsonValue)
    await setCachedLeg(keyB, { leg: 'b' } as Prisma.InputJsonValue)

    const found = await getCachedLegs([keyA, keyB, keyC])
    expect(found.get(keyA)).toEqual({ leg: 'a' })
    expect(found.get(keyB)).toEqual({ leg: 'b' })
    expect(found.has(keyC)).toBe(false)
    expect(found.size).toBe(2)

    const empty = await getCachedLegs([])
    expect(empty.size).toBe(0)
    expect(prisma.routeLegCache.findMany).toHaveBeenCalledTimes(1)
  })

  it('批量读里的过期条目按未命中并清理', async () => {
    const keyFresh = routeLegCacheKey('t-batch-fresh')
    const keyStale = routeLegCacheKey('t-batch-stale')
    await setCachedLeg(keyFresh, { leg: 'fresh' } as Prisma.InputJsonValue)
    await setCachedLeg(keyStale, { leg: 'stale' } as Prisma.InputJsonValue, 0)

    const found = await getCachedLegs([keyFresh, keyStale])
    expect(found.get(keyFresh)).toEqual({ leg: 'fresh' })
    expect(found.has(keyStale)).toBe(false)
    await vi.waitFor(() => {
      expect(prisma.routeLegCache.deleteMany).toHaveBeenCalled()
    })
  })

  it('库抛错按全未命中/写失败静默', async () => {
    vi.mocked(prisma.routeLegCache.findMany).mockRejectedValueOnce(new Error('db down') as never)
    vi.mocked(prisma.routeLegCache.upsert).mockRejectedValueOnce(new Error('db down') as never)

    const key = routeLegCacheKey('t-db-down')
    const found = await getCachedLegs([key])
    expect(found.size).toBe(0)

    await expect(setCachedRoutePayload(key, { x: 1 } as Prisma.InputJsonValue)).resolves.toBeUndefined()
  })
})
