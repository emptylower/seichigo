import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAnitabiApiDeps: vi.fn(),
  getSession: vi.fn(),
  now: vi.fn(),
  prisma: {
    mapImageDiagEvent: {
      groupBy: vi.fn(),
    },
  },
}))

vi.mock('@/lib/anitabi/api', () => ({
  getAnitabiApiDeps: () => mocks.getAnitabiApiDeps(),
}))

describe('GET /api/admin/anitabi/image-mirror/cache-state', () => {
  const now = new Date('2026-05-04T12:00:00.000Z')

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    mocks.getAnitabiApiDeps.mockResolvedValue({
      prisma: mocks.prisma,
      getSession: () => mocks.getSession(),
      now: () => mocks.now(),
    })
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.now.mockReturnValue(now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u-1', isAdmin: false } })

    const handlers = await import('app/api/admin/anitabi/image-mirror/cache-state/route')
    const res = await handlers.GET()

    expect(res.status).toBe(403)
    expect(mocks.prisma.mapImageDiagEvent.groupBy).not.toHaveBeenCalled()
  })

  it('aggregates outcome counts and computes the R2 hit ratio per window', async () => {
    mocks.prisma.mapImageDiagEvent.groupBy
      .mockResolvedValueOnce([
        { outcome: 'cache_hit_cf', _count: { _all: 100 } },
        { outcome: 'cache_hit_r2_primary', _count: { _all: 60 } },
        { outcome: 'cache_hit_r2_fallback', _count: { _all: 20 } },
        { outcome: 'cache_miss_all', _count: { _all: 15 } },
        { outcome: 'cache_full_miss_failed', _count: { _all: 5 } },
        { outcome: 'unexpected', _count: { _all: 0 } },
      ])
      .mockResolvedValueOnce([
        { outcome: 'cache_hit_cf', _count: { _all: 1000 } },
        { outcome: 'cache_hit_r2_primary', _count: { _all: 800 } },
        { outcome: 'cache_hit_r2_fallback', _count: { _all: 0 } },
        { outcome: 'cache_full_miss_failed', _count: { _all: 200 } },
      ])

    const handlers = await import('app/api/admin/anitabi/image-mirror/cache-state/route')
    const res = await handlers.GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sliTarget).toBe(0.8)
    expect(body.windows['1h'].total).toBe(200)
    expect(body.windows['1h'].outcomes).toMatchObject({
      cache_hit_cf: 100,
      cache_hit_r2_primary: 60,
      cache_hit_r2_fallback: 20,
      cache_miss_all: 15,
      cache_full_miss_failed: 5,
    })
    expect(body.windows['1h'].r2HitRatio).toBeCloseTo(80 / 200, 5)
    expect(body.windows['24h'].r2HitRatio).toBeCloseTo(800 / 2000, 5)

    expect(mocks.prisma.mapImageDiagEvent.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['outcome'],
      where: {
        stage: 'image_cache_state',
        createdAt: { gt: new Date('2026-05-04T11:00:00.000Z') },
      },
      _count: { _all: true },
    })
    expect(mocks.prisma.mapImageDiagEvent.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['outcome'],
      where: {
        stage: 'image_cache_state',
        createdAt: { gt: new Date('2026-05-03T12:00:00.000Z') },
      },
      _count: { _all: true },
    })
  })

  it('returns null r2HitRatio when no events were captured', async () => {
    mocks.prisma.mapImageDiagEvent.groupBy.mockResolvedValue([])

    const handlers = await import('app/api/admin/anitabi/image-mirror/cache-state/route')
    const res = await handlers.GET()
    const body = await res.json()

    expect(body.windows['1h'].total).toBe(0)
    expect(body.windows['1h'].r2HitRatio).toBeNull()
    expect(body.windows['24h'].r2HitRatio).toBeNull()
  })

  it('classifies unrecognized outcomes under "other" without inflating tracked totals', async () => {
    mocks.prisma.mapImageDiagEvent.groupBy.mockResolvedValue([
      { outcome: 'cache_hit_r2_primary', _count: { _all: 5 } },
      { outcome: 'mystery_outcome', _count: { _all: 3 } },
      { outcome: null, _count: { _all: 2 } },
    ])

    const handlers = await import('app/api/admin/anitabi/image-mirror/cache-state/route')
    const res = await handlers.GET()
    const body = await res.json()

    expect(body.windows['1h'].outcomes.cache_hit_r2_primary).toBe(5)
    expect(body.windows['1h'].outcomes.other).toBe(5)
    expect(body.windows['1h'].total).toBe(10)
    expect(body.windows['1h'].r2HitRatio).toBeCloseTo(5 / 10, 5)
  })
})
