import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { createLegPoolResolver } from '@/lib/routeBook/legPool'
import { googleLegCacheRawKey } from '@/lib/routeBook/legResolverGoogle'
import { routeLegCacheKey } from '@/lib/routeBook/legCache'
import type { LegResolver, LegStop } from '@/lib/routeBook/legs'

// 与 legs.test.ts 相同：批量缓存读替换为可控内存实现（sha256 key 保持真实）
const legCacheBatches = vi.hoisted(() => new Map<string, Prisma.JsonValue>())
vi.mock('@/lib/routeBook/legCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/routeBook/legCache')>()
  return {
    ...actual,
    getCachedLegs: vi.fn(async (keys: string[]) => {
      const out = new Map<string, Prisma.JsonValue>()
      for (const key of keys) {
        const hit = legCacheBatches.get(key)
        if (hit !== undefined) out.set(key, hit)
      }
      return out
    }),
  }
})

const A: LegStop = { id: 'a', lat: 35.0, lng: 135.0, legMode: null }
const B: LegStop = { id: 'b', lat: 35.003, lng: 135.003, legMode: null }

describe('createLegPoolResolver', () => {
  it('上游调用带 skipCacheRead: true（池已批量读过缓存，避免逐段重复读）', async () => {
    const upstream = vi.fn(async () => null)
    const pool = await createLegPoolResolver(upstream as unknown as LegResolver, [A, B], 'walking')
    await pool.resolve(A, B, 'walking')
    expect(upstream).toHaveBeenCalledWith(A, B, 'walking', { skipCacheRead: true })
  })

  it('isCached 反映批量读命中情况', async () => {
    const raw = googleLegCacheRawKey('walking', A, B)
    legCacheBatches.set(routeLegCacheKey(raw), { durationSec: 321, distanceM: 654, polyline: null, source: 'google' })
    const pool = await createLegPoolResolver(vi.fn(async () => null), [A, B], 'walking')
    expect(pool.isCached(raw)).toBe(true)
    expect(pool.isCached(googleLegCacheRawKey('driving', A, B))).toBe(false)
  })
})
