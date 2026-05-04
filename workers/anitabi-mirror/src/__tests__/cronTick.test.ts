import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'
import type { MirrorWorkerEnv } from '../index'

const {
  reclaimStaleMock,
  advanceBootstrapMock,
  processSeedBatchMock,
  isThrottledMock,
  recordTimeoutMock,
} = vi.hoisted(() => ({
  reclaimStaleMock: vi.fn(),
  advanceBootstrapMock: vi.fn(),
  processSeedBatchMock: vi.fn(),
  isThrottledMock: vi.fn(),
  recordTimeoutMock: vi.fn(),
}))

vi.mock('@/lib/anitabi/mirror/reclaim', () => ({
  reclaimStale: reclaimStaleMock,
}))

vi.mock('@/lib/anitabi/mirror/bootstrap', () => ({
  advanceBootstrap: advanceBootstrapMock,
}))

vi.mock('@/lib/anitabi/mirror/seed', () => ({
  processSeedBatch: processSeedBatchMock,
}))

vi.mock('@/lib/anitabi/mirror/throttle', () => ({
  isThrottled: isThrottledMock,
  recordTimeout: recordTimeoutMock,
}))

type BootstrapStatusRow = {
  bangumiCompleted: boolean
  pointCompleted: boolean
}

type CronTickPrismaStub = {
  mapImageMirrorBootstrap: {
    findUnique: ReturnType<typeof vi.fn>
  }
}

function createBucket(): R2MirrorBucket {
  return {
    head: vi.fn().mockResolvedValue(null),
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue({}),
  }
}

function createCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    exports: {} as Cloudflare.Exports,
    props: undefined,
  }
}

function createController(cron: string): ScheduledController {
  return {
    cron,
    scheduledTime: Date.now(),
    noRetry: vi.fn(),
  }
}

function createCronTickPrisma(bootstrapStatus: BootstrapStatusRow | null): CronTickPrismaStub {
  return {
    mapImageMirrorBootstrap: {
      findUnique: vi.fn().mockResolvedValue(bootstrapStatus),
    },
  }
}

async function loadCronTick() {
  vi.resetModules()
  vi.doUnmock('@/lib/anitabi/mirror/cronTick')
  return import('@/lib/anitabi/mirror/cronTick')
}

async function loadIndexWithMocks(opts?: {
  cronTickResult?: {
    reclaimed: number
    mirrored: number
    failed: number
    skipped404: number
    throttled: boolean
    retried?: number
  }
  cronTickError?: Error
  cronDeltaResult?: { enqueued: number }
  cronDeltaError?: Error
}) {
  vi.resetModules()

  const disconnectMock = vi.fn().mockResolvedValue(undefined)
  const prismaInstance = { $disconnect: disconnectMock }
  const createMirrorPrismaClientMock = vi.fn(() => prismaInstance)
  const cronTickMock = opts?.cronTickError
    ? vi.fn().mockRejectedValue(opts.cronTickError)
    : vi.fn().mockResolvedValue(
        opts?.cronTickResult ?? {
          reclaimed: 0,
          mirrored: 0,
          failed: 0,
          skipped404: 0,
          throttled: false,
          retried: 0,
        },
      )
  const cronDeltaMock = opts?.cronDeltaError
    ? vi.fn().mockRejectedValue(opts.cronDeltaError)
    : vi.fn().mockResolvedValue(opts?.cronDeltaResult ?? { enqueued: 0 })

  vi.doMock('../prisma', () => ({
    createMirrorPrismaClient: createMirrorPrismaClientMock,
  }))
  vi.doMock('@/lib/anitabi/mirror/cronTick', () => ({
    cronTick: cronTickMock,
  }))
  vi.doMock('@/lib/anitabi/mirror/delta', () => ({
    cronDelta: cronDeltaMock,
  }))

  const mod = await import('../index')
  return {
    worker: mod.default,
    createMirrorPrismaClientMock,
    prismaInstance,
    disconnectMock,
    cronTickMock,
    cronDeltaMock,
  }
}

async function loadPrismaFactoryWithMocks() {
  vi.resetModules()

  const adapterInstance = { kind: 'pg-adapter' }
  const prismaInstance = { kind: 'prisma-client' }
  const prismaPgMock = vi.fn(() => adapterInstance)
  const prismaClientMock = vi.fn(() => prismaInstance)

  vi.doMock('@prisma/adapter-pg', () => ({
    PrismaPg: prismaPgMock,
  }))
  vi.doMock('@prisma/client/wasm', () => ({
    PrismaClient: prismaClientMock,
  }))

  const mod = await import('../prisma')
  return {
    createMirrorPrismaClient: mod.createMirrorPrismaClient,
    prismaPgMock,
    prismaClientMock,
    adapterInstance,
    prismaInstance,
  }
}

beforeEach(() => {
  reclaimStaleMock.mockReset()
  advanceBootstrapMock.mockReset()
  processSeedBatchMock.mockReset()
  isThrottledMock.mockReset()
  recordTimeoutMock.mockReset()
  recordTimeoutMock.mockResolvedValue(undefined)
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
  vi.doUnmock('@/lib/anitabi/mirror/cronTick')
  vi.doUnmock('@/lib/anitabi/mirror/delta')
  vi.doUnmock('../prisma')
  vi.doUnmock('@prisma/adapter-pg')
  vi.doUnmock('@prisma/client/wasm')
})

describe('cronTick', () => {
  it('runs reclaim first and short-circuits when throttled', async () => {
    const events: string[] = []
    reclaimStaleMock.mockImplementation(async () => {
      events.push('reclaim')
      return { count: 4 }
    })
    isThrottledMock.mockImplementation(async () => {
      events.push('throttle')
      return true
    })

    const { cronTick } = await loadCronTick()
    const prisma = createCronTickPrisma(null)

    await expect(cronTick(prisma as never, createBucket(), { source: 'auto' })).resolves.toEqual({
      reclaimed: 4,
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      throttled: true,
    })

    expect(events).toEqual(['reclaim', 'throttle'])
    expect(prisma.mapImageMirrorBootstrap.findUnique).not.toHaveBeenCalled()
    expect(advanceBootstrapMock).not.toHaveBeenCalled()
    expect(processSeedBatchMock).not.toHaveBeenCalled()
  })

  it('bootstraps absent state with auto chunk size and returns seed counts including retried', async () => {
    reclaimStaleMock.mockResolvedValue({ count: 2 })
    isThrottledMock.mockResolvedValue(false)
    advanceBootstrapMock.mockResolvedValue(undefined)
    processSeedBatchMock.mockResolvedValue({
      mirrored: 7,
      failed: 1,
      skipped404: 3,
      retried: 5,
      timedOut: 0,
    })

    const { cronTick } = await loadCronTick()
    const prisma = createCronTickPrisma(null)
    const bucket = createBucket()

    await expect(cronTick(prisma as never, bucket, { source: 'auto' })).resolves.toEqual({
      reclaimed: 2,
      mirrored: 7,
      failed: 1,
      skipped404: 3,
      retried: 5,
      throttled: false,
    })

    expect(prisma.mapImageMirrorBootstrap.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
    })
    expect(advanceBootstrapMock).toHaveBeenCalledWith(prisma, 2000)
    expect(processSeedBatchMock).toHaveBeenCalledWith(prisma, bucket, {
      batchSize: 100,
      perRequestDelayMs: 200,
    })
  })

  it('bootstraps incomplete state with auto chunk size', async () => {
    reclaimStaleMock.mockResolvedValue({ count: 0 })
    isThrottledMock.mockResolvedValue(false)
    processSeedBatchMock.mockResolvedValue({
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      retried: 0,
      timedOut: 0,
    })

    const { cronTick } = await loadCronTick()
    const prisma = createCronTickPrisma({
      bangumiCompleted: true,
      pointCompleted: false,
    })

    await cronTick(prisma as never, createBucket(), { source: 'auto' })

    expect(advanceBootstrapMock).toHaveBeenCalledWith(prisma, 2000)
  })

  it('skips bootstrap when both bootstrap phases are already complete', async () => {
    reclaimStaleMock.mockResolvedValue({ count: 1 })
    isThrottledMock.mockResolvedValue(false)
    processSeedBatchMock.mockResolvedValue({
      mirrored: 1,
      failed: 0,
      skipped404: 0,
      retried: 0,
      timedOut: 0,
    })

    const { cronTick } = await loadCronTick()
    const prisma = createCronTickPrisma({
      bangumiCompleted: true,
      pointCompleted: true,
    })

    await cronTick(prisma as never, createBucket(), { source: 'auto' })

    expect(advanceBootstrapMock).not.toHaveBeenCalled()
    expect(processSeedBatchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the manual bootstrap chunk size for manual runs', async () => {
    reclaimStaleMock.mockResolvedValue({ count: 0 })
    isThrottledMock.mockResolvedValue(false)
    processSeedBatchMock.mockResolvedValue({
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      retried: 0,
      timedOut: 0,
    })

    const { cronTick } = await loadCronTick()
    const prisma = createCronTickPrisma({
      bangumiCompleted: false,
      pointCompleted: false,
    })

    await cronTick(prisma as never, createBucket(), { source: 'manual' })

    expect(advanceBootstrapMock).toHaveBeenCalledWith(prisma, 5000)
  })

  it('feeds seed-batch timeouts into recordTimeout so the breaker can engage', async () => {
    reclaimStaleMock.mockResolvedValue({ count: 0 })
    isThrottledMock.mockResolvedValue(false)
    processSeedBatchMock.mockResolvedValue({
      mirrored: 1,
      failed: 0,
      skipped404: 0,
      retried: 9,
      timedOut: 9,
    })

    const { cronTick } = await loadCronTick()
    const prisma = createCronTickPrisma({
      bangumiCompleted: true,
      pointCompleted: true,
    })

    await cronTick(prisma as never, createBucket(), { source: 'auto' })

    expect(recordTimeoutMock).toHaveBeenCalledWith(prisma, 9)
  })

  it('does not call recordTimeout when no seed timeouts occurred', async () => {
    reclaimStaleMock.mockResolvedValue({ count: 0 })
    isThrottledMock.mockResolvedValue(false)
    processSeedBatchMock.mockResolvedValue({
      mirrored: 5,
      failed: 0,
      skipped404: 0,
      retried: 1,
      timedOut: 0,
    })

    const { cronTick } = await loadCronTick()
    const prisma = createCronTickPrisma({
      bangumiCompleted: true,
      pointCompleted: true,
    })

    await cronTick(prisma as never, createBucket(), { source: 'auto' })

    expect(recordTimeoutMock).not.toHaveBeenCalled()
  })
})

describe('scheduled worker entry', () => {
  it('builds a worker-safe Prisma client with the pg adapter', async () => {
    const { createMirrorPrismaClient, prismaPgMock, prismaClientMock, adapterInstance, prismaInstance } =
      await loadPrismaFactoryWithMocks()

    expect(createMirrorPrismaClient('postgres://db')).toBe(prismaInstance)
    expect(prismaPgMock).toHaveBeenCalledWith({
      connectionString: 'postgres://db',
      max: 1,
      connectionTimeoutMillis: 8_000,
      query_timeout: 12_000,
      statement_timeout: 12_000,
      idleTimeoutMillis: 30_000,
    })
    expect(prismaClientMock).toHaveBeenCalledWith({
      adapter: adapterInstance,
    })
  })

  it('returns early when the cron flag is disabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { worker, createMirrorPrismaClientMock, cronDeltaMock, cronTickMock } = await loadIndexWithMocks()

    await worker.scheduled?.(
      createController('*/5 * * * *'),
      {
        MAP_IMAGE_MIRROR_CRON_ENABLED: '0',
        DATABASE_URL: 'postgres://db',
        MAP_IMAGE_CACHE: createBucket(),
      } as unknown as MirrorWorkerEnv,
      createCtx(),
    )

    expect(createMirrorPrismaClientMock).not.toHaveBeenCalled()
    expect(cronDeltaMock).not.toHaveBeenCalled()
    expect(cronTickMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('[mirror] cron disabled by flag')
  })

  it('routes hourly schedules to cronDelta and disconnects Prisma', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { worker, createMirrorPrismaClientMock, prismaInstance, disconnectMock, cronDeltaMock, cronTickMock } =
      await loadIndexWithMocks({
        cronDeltaResult: { enqueued: 9 },
      })

    await worker.scheduled?.(
      createController('0 * * * *'),
      {
        MAP_IMAGE_MIRROR_CRON_ENABLED: '1',
        DATABASE_URL: 'postgres://db',
        MAP_IMAGE_CACHE: createBucket(),
      } as unknown as MirrorWorkerEnv,
      createCtx(),
    )

    expect(createMirrorPrismaClientMock).toHaveBeenCalledWith('postgres://db')
    expect(cronDeltaMock).toHaveBeenCalledWith(prismaInstance)
    expect(cronTickMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('[mirror] delta tick enqueued=9')
    expect(disconnectMock).toHaveBeenCalledTimes(1)
  })

  it('routes non-hourly schedules to cronTick and logs retried counts', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { worker, prismaInstance, disconnectMock, cronDeltaMock, cronTickMock } =
      await loadIndexWithMocks({
        cronTickResult: {
          reclaimed: 3,
          mirrored: 8,
          failed: 2,
          skipped404: 4,
          retried: 6,
          throttled: false,
        },
      })
    const bucket = createBucket()

    await worker.scheduled?.(
      createController('*/5 * * * *'),
      {
        MAP_IMAGE_MIRROR_CRON_ENABLED: '1',
        DATABASE_URL: 'postgres://db',
        MAP_IMAGE_CACHE: bucket,
      } as unknown as MirrorWorkerEnv,
      createCtx(),
    )

    expect(cronDeltaMock).not.toHaveBeenCalled()
    expect(cronTickMock).toHaveBeenCalledWith(prismaInstance, bucket, { source: 'auto' })
    expect(logSpy).toHaveBeenCalledWith(
      '[mirror] tick reclaimed=3 mirrored=8 failed=2 404=4 retried=6 throttled=false',
    )
    expect(disconnectMock).toHaveBeenCalledTimes(1)
  })

  it('logs scheduled failures, rejects, and still disconnects Prisma', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failure = new Error('tick exploded')
    const { worker, disconnectMock } = await loadIndexWithMocks({
      cronTickError: failure,
    })

    await expect(
      worker.scheduled?.(
        createController('*/5 * * * *'),
        {
          MAP_IMAGE_MIRROR_CRON_ENABLED: '1',
          DATABASE_URL: 'postgres://db',
          MAP_IMAGE_CACHE: createBucket(),
        } as unknown as MirrorWorkerEnv,
        createCtx(),
      ),
    ).rejects.toThrow('tick exploded')

    expect(errorSpy).toHaveBeenCalledWith('[mirror] tick failed', failure)
    expect(disconnectMock).toHaveBeenCalledTimes(1)
  })
})
