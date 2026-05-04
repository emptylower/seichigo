import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAnitabiApiDeps: vi.fn(),
  getSession: vi.fn(),
  now: vi.fn(),
  prisma: {
    mapImageMirrorBootstrap: {
      findUnique: vi.fn(),
    },
    mapImageMirrorState: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock('@/lib/anitabi/api', () => ({
  getAnitabiApiDeps: () => mocks.getAnitabiApiDeps(),
}))

describe('GET /api/admin/anitabi/image-mirror/status', () => {
  const now = new Date('2026-05-03T12:00:00.000Z')

  beforeEach(() => {
    vi.resetAllMocks()
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    mocks.getAnitabiApiDeps.mockResolvedValue({
      prisma: mocks.prisma,
      getSession: () => mocks.getSession(),
      now: () => mocks.now(),
    })
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.now.mockReturnValue(now)
    mocks.prisma.mapImageMirrorBootstrap.findUnique.mockResolvedValue({
      id: 1,
      bangumiCursor: 12,
      pointCursor: 'pt-7',
      bangumiCompleted: false,
      pointCompleted: false,
      totalEnumerated: 99,
      startedAt: new Date('2026-05-03T00:00:00.000Z'),
      completedAt: null,
      lastAdvanceAt: new Date('2026-05-03T00:01:00.000Z'),
      manuallyTriggered: true,
    })
    mocks.prisma.mapImageMirrorState.groupBy.mockResolvedValue([
      { status: 'pending', _count: { _all: 3 } },
      { status: 'in_progress', _count: { _all: 2 } },
      { status: 'mirrored', _count: { _all: 8 } },
      { status: 'failed', _count: { _all: 1 } },
      { status: 'skipped_404', _count: { _all: 4 } },
    ])
    mocks.prisma.mapImageMirrorState.findMany.mockResolvedValue([
      {
        canonicalUrl: 'https://img.example.com/a.webp',
        lastError: 'HTTP 502',
        attempts: 3,
        lastAttemptAt: new Date('2026-05-03T11:59:00.000Z'),
      },
      {
        canonicalUrl: 'https://img.example.com/b.webp',
        lastError: 'timeout',
        attempts: 2,
        lastAttemptAt: new Date('2026-05-03T11:58:00.000Z'),
      },
    ])
    mocks.prisma.mapImageMirrorState.count
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(24)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/anitabi/image-mirror/status/route')
    const res = await handlers.GET()

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' })
    expect(mocks.prisma.mapImageMirrorState.groupBy).not.toHaveBeenCalled()
    expect(mocks.prisma.mapImageMirrorBootstrap.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.mapImageMirrorState.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.mapImageMirrorState.count).not.toHaveBeenCalled()
  })

  it('returns aggregate status payload with recent failures and rates', async () => {
    const handlers = await import('app/api/admin/anitabi/image-mirror/status/route')
    const res = await handlers.GET()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      totals: {
        all: 18,
        pending: 3,
        in_progress: 2,
        mirrored: 8,
        failed: 1,
        skipped_404: 4,
      },
      bootstrap: {
        id: 1,
        pointCursor: 'pt-7',
        totalEnumerated: 99,
      },
      recentFailures: [
        {
          canonicalUrl: 'https://img.example.com/a.webp',
          lastError: 'HTTP 502',
          attempts: 3,
        },
        {
          canonicalUrl: 'https://img.example.com/b.webp',
          lastError: 'timeout',
          attempts: 2,
        },
      ],
      rates: {
        remaining: 5,
        mirroredLast1h: 6,
        mirroredLast24h: 24,
        ratePerSec: 6 / 3600,
        estimatedRemainingHours: 5 / 6,
      },
    })

    expect(mocks.prisma.mapImageMirrorState.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { sourceType: { notIn: ['__throttle__', '__cursor__'] } },
      _count: { _all: true },
    })
    expect(mocks.prisma.mapImageMirrorBootstrap.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
    })
    expect(mocks.prisma.mapImageMirrorState.findMany).toHaveBeenCalledWith({
      where: {
        status: 'failed',
        sourceType: { notIn: ['__throttle__', '__cursor__'] },
      },
      orderBy: { lastAttemptAt: 'desc' },
      take: 10,
      select: {
        canonicalUrl: true,
        lastError: true,
        attempts: true,
        lastAttemptAt: true,
      },
    })
    expect(mocks.prisma.mapImageMirrorState.count).toHaveBeenNthCalledWith(1, {
      where: {
        status: 'mirrored',
        mirroredAt: { gt: new Date('2026-05-03T11:00:00.000Z') },
        sourceType: { notIn: ['__throttle__', '__cursor__'] },
      },
    })
    expect(mocks.prisma.mapImageMirrorState.count).toHaveBeenNthCalledWith(2, {
      where: {
        status: 'mirrored',
        mirroredAt: { gt: new Date('2026-05-02T12:00:00.000Z') },
        sourceType: { notIn: ['__throttle__', '__cursor__'] },
      },
    })
  })

  it('returns stable zero totals for missing statuses and null eta when rate is zero', async () => {
    mocks.prisma.mapImageMirrorState.groupBy.mockResolvedValue([
      { status: 'mirrored', _count: { _all: 8 } },
      { status: 'failed', _count: { _all: 2 } },
    ])
    mocks.prisma.mapImageMirrorState.count.mockReset()
    mocks.prisma.mapImageMirrorState.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(4)

    const handlers = await import('app/api/admin/anitabi/image-mirror/status/route')
    const res = await handlers.GET()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      totals: {
        all: 10,
        pending: 0,
        in_progress: 0,
        mirrored: 8,
        failed: 2,
        skipped_404: 0,
      },
      rates: {
        remaining: 0,
        mirroredLast1h: 0,
        mirroredLast24h: 4,
        ratePerSec: 0,
        estimatedRemainingHours: null,
      },
    })
  })

  it.each(['P2021', 'P2022'])('maps prisma migration error %s to 503', async (code) => {
    mocks.getAnitabiApiDeps.mockRejectedValue(Object.assign(new Error('missing table'), { code }))

    const handlers = await import('app/api/admin/anitabi/image-mirror/status/route')
    const res = await handlers.GET()

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({
      error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试',
    })
  })

  it('maps missing DATABASE_URL to 503', async () => {
    mocks.getAnitabiApiDeps.mockRejectedValue(new Error('Environment variable not found: DATABASE_URL'))

    const handlers = await import('app/api/admin/anitabi/image-mirror/status/route')
    const res = await handlers.GET()

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: '数据库未配置' })
  })

  it('maps unknown errors to 500 and logs context', async () => {
    const error = new Error('boom')
    mocks.prisma.mapImageMirrorState.groupBy.mockRejectedValue(error)

    const handlers = await import('app/api/admin/anitabi/image-mirror/status/route')
    const res = await handlers.GET()

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Internal server error' })
    expect(console.error).toHaveBeenCalledWith('[api/admin/anitabi/image-mirror/status] GET failed', error)
  })
})
