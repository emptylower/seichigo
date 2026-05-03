import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { enumerateBangumiCoverVariants, enumeratePointImageVariants } from '@/lib/anitabi/imageMirrorVariants'
import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'
import { reconcileMirrorAfterDiff } from '@/lib/anitabi/sync/mirrorReconcile'

const workflowMocks = vi.hoisted(() => ({
  fetchJsonWithRetry: vi.fn(),
  fetchTextWithRetry: vi.fn(),
  writeRawJson: vi.fn(),
  writeRawText: vi.fn(),
  enqueueMapTranslationTasksForBangumiIds: vi.fn(),
  reconcileMirrorAfterDiff: vi.fn(),
}))

vi.mock('@/lib/anitabi/source/client', () => ({
  fetchJsonWithRetry: workflowMocks.fetchJsonWithRetry,
  fetchTextWithRetry: workflowMocks.fetchTextWithRetry,
}))

vi.mock('@/lib/anitabi/sync/rawStore', () => ({
  writeRawJson: workflowMocks.writeRawJson,
  writeRawText: workflowMocks.writeRawText,
}))

vi.mock('@/lib/translation/mapTaskEnqueue', () => ({
  enqueueMapTranslationTasksForBangumiIds: workflowMocks.enqueueMapTranslationTasksForBangumiIds,
}))

type MirrorChange = {
  id: number | string
  field: string
  oldValue: string | null
  newValue: string | null
}

function createPrismaMock() {
  return {
    mapImageMirrorState: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  }
}

function createWorkflowDeps(): AnitabiApiDeps {
  return {
    prisma: {
      anitabiSyncRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      anitabiBangumi: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 1,
            sourceModifiedMs: BigInt(1),
            meta: { pointsLength: 0 },
          },
        ]),
        findUnique: vi.fn().mockResolvedValue({
          cover: 'https://image.anitabi.cn/bangumi/1/old.jpg',
        }),
        upsert: vi.fn().mockResolvedValue({}),
      },
      anitabiBangumiMeta: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      anitabiPoint: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      anitabiSourceCursor: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    } as unknown as AnitabiApiDeps['prisma'],
    getSession: async () => null,
    now: () => new Date('2026-05-03T00:00:00.000Z'),
    getCronSecret: () => '',
    getApiBase: () => 'https://api.anitabi.cn',
    getSiteBase: () => 'https://www.anitabi.cn',
  }
}

async function expectedJpegKeys(urls: string[]) {
  return Promise.all(urls.map((url) => computeMirrorKey(url, 'image/jpeg')))
}

describe('reconcileMirrorAfterDiff', () => {
  it('upserts cover variants and resets old bangumi rows', async () => {
    const prisma = createPrismaMock()
    const change: MirrorChange = {
      id: 123,
      field: 'cover',
      oldValue: 'https://image.anitabi.cn/bangumi/123/old.jpg',
      newValue: 'https://image.anitabi.cn/bangumi/123/new.jpg',
    }

    await reconcileMirrorAfterDiff(prisma as never, {
      bangumiChanges: [change],
      pointChanges: [],
    })

    expect(prisma.mapImageMirrorState.updateMany).toHaveBeenCalledWith({
      where: { sourceType: 'bangumi-cover', sourceId: '123' },
      data: {
        status: 'pending',
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        mirroredAt: null,
        contentBytes: null,
      },
    })

    const variants = enumerateBangumiCoverVariants(change.newValue)
    const expectedKeys = await expectedJpegKeys(variants.map((variant) => variant.url))

    expect(prisma.mapImageMirrorState.upsert).toHaveBeenCalledTimes(variants.length)
    for (const [index, variant] of variants.entries()) {
      expect(prisma.mapImageMirrorState.upsert).toHaveBeenNthCalledWith(index + 1, {
        where: {
          sourceType_sourceId_variant: {
            sourceType: 'bangumi-cover',
            sourceId: '123',
            variant: variant.label,
          },
        },
        create: {
          sourceType: 'bangumi-cover',
          sourceId: '123',
          variant: variant.label,
          canonicalUrl: variant.url,
          r2Key: expectedKeys[index],
          status: 'pending',
          attempts: 0,
          lastAttemptAt: null,
          lastError: null,
          mirroredAt: null,
          contentBytes: null,
        },
        update: {
          canonicalUrl: variant.url,
          r2Key: expectedKeys[index],
          status: 'pending',
          attempts: 0,
          lastAttemptAt: null,
          lastError: null,
          mirroredAt: null,
          contentBytes: null,
        },
      })
    }
  })

  it('skips non-cover and non-image fields', async () => {
    const prisma = createPrismaMock()

    await reconcileMirrorAfterDiff(prisma as never, {
      bangumiChanges: [
        {
          id: 123,
          field: 'titleZh',
          oldValue: 'old',
          newValue: 'new',
        },
      ],
      pointChanges: [
        {
          id: '123:point-1',
          field: 'originUrl',
          oldValue: 'https://example.com/old',
          newValue: 'https://example.com/new',
        },
      ],
    })

    expect(prisma.mapImageMirrorState.updateMany).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.upsert).not.toHaveBeenCalled()
  })

  it('handles point image variants', async () => {
    const prisma = createPrismaMock()
    const change: MirrorChange = {
      id: '123:point-1',
      field: 'image',
      oldValue: 'https://image.anitabi.cn/points/old.jpg',
      newValue: 'https://image.anitabi.cn/points/new.jpg',
    }

    await reconcileMirrorAfterDiff(prisma as never, {
      bangumiChanges: [],
      pointChanges: [change],
    })

    expect(prisma.mapImageMirrorState.updateMany).toHaveBeenCalledWith({
      where: { sourceType: 'point-image', sourceId: '123:point-1' },
      data: {
        status: 'pending',
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        mirroredAt: null,
        contentBytes: null,
      },
    })

    const variants = enumeratePointImageVariants(change.newValue)
    const expectedKeys = await expectedJpegKeys(variants.map((variant) => variant.url))

    expect(prisma.mapImageMirrorState.upsert).toHaveBeenCalledTimes(variants.length)
    for (const [index, variant] of variants.entries()) {
      expect(prisma.mapImageMirrorState.upsert).toHaveBeenNthCalledWith(index + 1, {
        where: {
          sourceType_sourceId_variant: {
            sourceType: 'point-image',
            sourceId: '123:point-1',
            variant: variant.label,
          },
        },
        create: expect.objectContaining({
          sourceType: 'point-image',
          sourceId: '123:point-1',
          variant: variant.label,
          canonicalUrl: variant.url,
          r2Key: expectedKeys[index],
        }),
        update: expect.objectContaining({
          canonicalUrl: variant.url,
          r2Key: expectedKeys[index],
          status: 'pending',
          attempts: 0,
          lastAttemptAt: null,
          lastError: null,
          mirroredAt: null,
          contentBytes: null,
        }),
      })
    }
  })

  it('skips unchanged, null, and empty URL updates', async () => {
    const prisma = createPrismaMock()

    await reconcileMirrorAfterDiff(prisma as never, {
      bangumiChanges: [
        {
          id: 1,
          field: 'cover',
          oldValue: 'https://image.anitabi.cn/bangumi/1/same.jpg',
          newValue: 'https://image.anitabi.cn/bangumi/1/same.jpg',
        },
        {
          id: 2,
          field: 'cover',
          oldValue: 'https://image.anitabi.cn/bangumi/2/old.jpg',
          newValue: null,
        },
      ],
      pointChanges: [
        {
          id: '2:point-1',
          field: 'image',
          oldValue: 'https://image.anitabi.cn/points/old.jpg',
          newValue: '   ',
        },
      ],
    })

    expect(prisma.mapImageMirrorState.updateMany).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.upsert).not.toHaveBeenCalled()
  })
})

describe('runAnitabiSync mirror reconcile hook', () => {
  const originalFlag = process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    workflowMocks.fetchJsonWithRetry
      .mockResolvedValueOnce([
        {
          id: 1,
          cn: 'Work',
          title: 'Work',
          cover: 'https://image.anitabi.cn/bangumi/1/new.jpg',
          modified: 2,
        },
      ])
      .mockResolvedValueOnce({
        id: 1,
        cn: 'Work',
        title: 'Work',
        cover: 'https://image.anitabi.cn/bangumi/1/new.jpg',
        modified: 2,
      })
      .mockResolvedValueOnce(null)
    workflowMocks.fetchTextWithRetry.mockResolvedValue(null)
    workflowMocks.writeRawJson.mockResolvedValue(undefined)
    workflowMocks.writeRawText.mockResolvedValue(undefined)
    workflowMocks.enqueueMapTranslationTasksForBangumiIds.mockResolvedValue(null)
    process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED = '1'
  })

  afterEach(() => {
    if (originalFlag == null) delete process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED
    else process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED = originalFlag
    vi.doUnmock('@/lib/anitabi/sync/mirrorReconcile')
    vi.restoreAllMocks()
  })

  it('warns and keeps sync successful when reconcile fails', async () => {
    const deps = createWorkflowDeps()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('mirror boom')

    workflowMocks.reconcileMirrorAfterDiff.mockRejectedValue(error)
    vi.doMock('@/lib/anitabi/sync/mirrorReconcile', () => ({
      reconcileMirrorAfterDiff: workflowMocks.reconcileMirrorAfterDiff,
    }))

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'delta' })

    expect(report.status).toBe('ok')
    expect(workflowMocks.reconcileMirrorAfterDiff).toHaveBeenCalledWith(deps.prisma, {
      bangumiChanges: [
        {
          id: 1,
          field: 'cover',
          oldValue: 'https://image.anitabi.cn/bangumi/1/old.jpg',
          newValue: 'https://image.anitabi.cn/bangumi/1/new.jpg',
        },
      ],
      pointChanges: [],
    })
    expect(warn).toHaveBeenCalledWith(
      '[anitabi/sync] mirror reconciliation failed for bangumi 1',
      error,
    )
  })

  it('skips mirror reconciliation when the flag is disabled', async () => {
    const deps = createWorkflowDeps()

    process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED = '0'
    workflowMocks.reconcileMirrorAfterDiff.mockResolvedValue(undefined)
    vi.doMock('@/lib/anitabi/sync/mirrorReconcile', () => ({
      reconcileMirrorAfterDiff: workflowMocks.reconcileMirrorAfterDiff,
    }))

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'delta' })

    expect(report.status).toBe('ok')
    expect(workflowMocks.reconcileMirrorAfterDiff).not.toHaveBeenCalled()
  })
})
