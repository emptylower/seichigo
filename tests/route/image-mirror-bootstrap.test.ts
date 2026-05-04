import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

const mocks = vi.hoisted(() => ({
  getAnitabiApiDeps: vi.fn(),
  cronTick: vi.fn(),
  getSession: vi.fn(),
  prisma: {
    mapImageMirrorBootstrap: {
      findUnique: vi.fn(),
    },
    mapImageMirrorState: {
      groupBy: vi.fn(),
    },
  },
}))

vi.mock('@/lib/anitabi/api', () => ({
  getAnitabiApiDeps: () => mocks.getAnitabiApiDeps(),
}))

vi.mock('@/lib/anitabi/mirror/cronTick', () => ({
  cronTick: mocks.cronTick,
}))

function createBucket(): R2MirrorBucket {
  return {
    head: vi.fn().mockResolvedValue(null),
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue({}),
  }
}

function jsonReq(url: string, body?: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  })
}

function invalidJsonReq(url: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  })
}

describe('POST /api/admin/anitabi/image-mirror/bootstrap', () => {
  const bucket = createBucket()
  const originalProcessBucket = process.env.MAP_IMAGE_CACHE

  beforeEach(() => {
    vi.resetAllMocks()
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    delete process.env.MAP_IMAGE_CACHE

    mocks.getAnitabiApiDeps.mockResolvedValue({
      prisma: mocks.prisma,
      getSession: () => mocks.getSession(),
    })
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.cronTick.mockResolvedValue({
      reclaimed: 0,
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      retried: 0,
      throttled: false,
    })
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
      { status: 'mirrored', _count: { _all: 8 } },
    ])

    ;(globalThis as typeof globalThis & {
      __openNextAls?: { getStore?: () => { env?: { MAP_IMAGE_CACHE?: R2MirrorBucket } } }
    }).__openNextAls = {
      getStore: () => ({ env: { MAP_IMAGE_CACHE: bucket } }),
    }
  })

  afterEach(() => {
    delete (globalThis as typeof globalThis & { __openNextAls?: unknown }).__openNextAls
    if (originalProcessBucket === undefined) {
      delete process.env.MAP_IMAGE_CACHE
    } else {
      process.env.MAP_IMAGE_CACHE = originalProcessBucket
    }
  })

  it('rejects non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap'))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' })
    expect(mocks.cronTick).not.toHaveBeenCalled()
    expect(mocks.prisma.mapImageMirrorBootstrap.findUnique).not.toHaveBeenCalled()
  })

  it('runs advance mode once and returns progress totals', async () => {
    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap', { mode: 'advance' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      bootstrap: {
        id: 1,
        bangumiCompleted: false,
        pointCompleted: false,
        totalEnumerated: 99,
        pointCursor: 'pt-7',
      },
      totals: {
        pending: 3,
        mirrored: 8,
      },
      elapsedMs: expect.any(Number),
      stillNeedsManualPush: true,
    })
    expect(mocks.cronTick).toHaveBeenCalledTimes(1)
    expect(mocks.cronTick).toHaveBeenCalledWith(mocks.prisma, bucket, { source: 'manual' })
    expect(mocks.prisma.mapImageMirrorState.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      _count: { _all: true },
    })
  })

  it('defaults invalid json to advance mode', async () => {
    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(invalidJsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap'))

    expect(res.status).toBe(200)
    expect(mocks.cronTick).toHaveBeenCalledTimes(1)
    expect(mocks.cronTick).toHaveBeenCalledWith(mocks.prisma, bucket, { source: 'manual' })
  })

  it('loops in force-complete mode until bootstrap completes', async () => {
    mocks.prisma.mapImageMirrorBootstrap.findUnique
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce({
        id: 1,
        bangumiCursor: 12,
        pointCursor: 'pt-8',
        bangumiCompleted: false,
        pointCompleted: false,
        totalEnumerated: 105,
        startedAt: new Date('2026-05-03T00:00:00.000Z'),
        completedAt: null,
        lastAdvanceAt: new Date('2026-05-03T00:01:30.000Z'),
        manuallyTriggered: true,
      })
      .mockResolvedValueOnce({
        id: 1,
        bangumiCursor: 12,
        pointCursor: 'pt-8',
        bangumiCompleted: true,
        pointCompleted: true,
        totalEnumerated: 110,
        startedAt: new Date('2026-05-03T00:00:00.000Z'),
        completedAt: new Date('2026-05-03T00:02:00.000Z'),
        lastAdvanceAt: new Date('2026-05-03T00:02:00.000Z'),
        manuallyTriggered: true,
      })

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(5_000)
      .mockReturnValueOnce(8_000)

    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap', { mode: 'force-complete' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      bootstrap: {
        bangumiCompleted: true,
        pointCompleted: true,
        totalEnumerated: 110,
      },
      stillNeedsManualPush: false,
      elapsedMs: 8_000,
    })
    expect(mocks.cronTick).toHaveBeenCalledTimes(2)
  })

  it('returns completed without ticking when force-complete starts from a finished bootstrap', async () => {
    mocks.prisma.mapImageMirrorBootstrap.findUnique.mockResolvedValue({
      id: 1,
      bangumiCursor: 12,
      pointCursor: 'pt-9',
      bangumiCompleted: true,
      pointCompleted: true,
      totalEnumerated: 110,
      startedAt: new Date('2026-05-03T00:00:00.000Z'),
      completedAt: new Date('2026-05-03T00:02:00.000Z'),
      lastAdvanceAt: new Date('2026-05-03T00:02:00.000Z'),
      manuallyTriggered: true,
    })

    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap', { mode: 'force-complete' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      bootstrap: {
        bangumiCompleted: true,
        pointCompleted: true,
      },
      stillNeedsManualPush: false,
    })
    expect(mocks.cronTick).not.toHaveBeenCalled()
    expect(mocks.prisma.mapImageMirrorBootstrap.findUnique).toHaveBeenCalledTimes(1)
  })

  it('stops force-complete mode after a throttled tick and reports remaining manual work', async () => {
    mocks.prisma.mapImageMirrorBootstrap.findUnique
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce({
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
    mocks.cronTick.mockResolvedValueOnce({
      reclaimed: 0,
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      throttled: true,
    })

    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap', { mode: 'force-complete' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      bootstrap: {
        bangumiCompleted: false,
        pointCompleted: false,
      },
      stillNeedsManualPush: true,
    })
    expect(mocks.cronTick).toHaveBeenCalledTimes(1)
  })

  it('does not start a second force-complete tick when the remaining budget is too small', async () => {
    mocks.prisma.mapImageMirrorBootstrap.findUnique
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce({
        id: 1,
        bangumiCursor: 12,
        pointCursor: 'pt-8',
        bangumiCompleted: false,
        pointCompleted: false,
        totalEnumerated: 105,
        startedAt: new Date('2026-05-03T00:00:00.000Z'),
        completedAt: null,
        lastAdvanceAt: new Date('2026-05-03T00:01:30.000Z'),
        manuallyTriggered: true,
      })

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(24_500)
      .mockReturnValueOnce(24_500)

    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap', { mode: 'force-complete' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      bootstrap: {
        bangumiCompleted: false,
        pointCompleted: false,
        pointCursor: 'pt-8',
      },
      stillNeedsManualPush: true,
      elapsedMs: 24_500,
    })
    expect(mocks.cronTick).toHaveBeenCalledTimes(1)
  })

  it('does not start a second force-complete tick exactly at the budget cutoff', async () => {
    mocks.prisma.mapImageMirrorBootstrap.findUnique
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce({
        id: 1,
        bangumiCursor: 12,
        pointCursor: 'pt-8',
        bangumiCompleted: false,
        pointCompleted: false,
        totalEnumerated: 105,
        startedAt: new Date('2026-05-03T00:00:00.000Z'),
        completedAt: null,
        lastAdvanceAt: new Date('2026-05-03T00:01:30.000Z'),
        manuallyTriggered: true,
      })
      .mockResolvedValueOnce({
        id: 1,
        bangumiCursor: 12,
        pointCursor: 'pt-9',
        bangumiCompleted: false,
        pointCompleted: false,
        totalEnumerated: 111,
        startedAt: new Date('2026-05-03T00:00:00.000Z'),
        completedAt: null,
        lastAdvanceAt: new Date('2026-05-03T00:02:00.000Z'),
        manuallyTriggered: true,
      })
    mocks.cronTick
      .mockResolvedValueOnce({
        reclaimed: 0,
        mirrored: 0,
        failed: 0,
        skipped404: 0,
        throttled: false,
      })
      .mockResolvedValueOnce({
        reclaimed: 0,
        mirrored: 0,
        failed: 0,
        skipped404: 0,
        throttled: true,
      })

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(24_000)
      .mockReturnValueOnce(24_000)

    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap', { mode: 'force-complete' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      bootstrap: {
        bangumiCompleted: false,
        pointCompleted: false,
        pointCursor: 'pt-8',
      },
      stillNeedsManualPush: true,
      elapsedMs: 24_000,
    })
    expect(mocks.cronTick).toHaveBeenCalledTimes(1)
  })

  it('returns 503 when only process.env provides a non-bucket mirror cache value', async () => {
    process.env.MAP_IMAGE_CACHE = 'not-a-bucket'
    delete (globalThis as typeof globalThis & { cloudflare?: unknown }).cloudflare
    delete (globalThis as typeof globalThis & { __openNextAls?: unknown }).__openNextAls
    mocks.getAnitabiApiDeps.mockResolvedValue({
      prisma: mocks.prisma,
      getSession: () => mocks.getSession(),
      env: undefined,
    })

    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap'))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'R2 缓存桶未配置' })
    expect(mocks.cronTick).not.toHaveBeenCalled()
  })

  it('maps missing mirror bucket config to 503 without running cronTick', async () => {
    delete (globalThis as typeof globalThis & { cloudflare?: unknown }).cloudflare
    delete (globalThis as typeof globalThis & { __openNextAls?: unknown }).__openNextAls
    delete process.env.MAP_IMAGE_CACHE
    mocks.getAnitabiApiDeps.mockResolvedValue({
      prisma: mocks.prisma,
      getSession: () => mocks.getSession(),
      env: undefined,
    })

    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap'))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'R2 缓存桶未配置' })
    expect(mocks.cronTick).not.toHaveBeenCalled()
  })

  it('skips force-complete ticks when the time budget is already exhausted', async () => {
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

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(27_000)
      .mockReturnValueOnce(27_000)

    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap', { mode: 'force-complete' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      bootstrap: {
        bangumiCompleted: false,
        pointCompleted: false,
      },
      stillNeedsManualPush: true,
      elapsedMs: 26_000,
    })
    expect(mocks.cronTick).not.toHaveBeenCalled()
  })

  it('maps prisma migration errors to 503', async () => {
    mocks.getAnitabiApiDeps.mockRejectedValue(Object.assign(new Error('missing table'), { code: 'P2021' }))

    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap'))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({
      error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试',
    })
  })

  it('maps missing DATABASE_URL to 503', async () => {
    mocks.getAnitabiApiDeps.mockRejectedValue(new Error('Environment variable not found: DATABASE_URL'))

    const handlers = await import('app/api/admin/anitabi/image-mirror/bootstrap/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/admin/anitabi/image-mirror/bootstrap'))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: '数据库未配置' })
  })

})
