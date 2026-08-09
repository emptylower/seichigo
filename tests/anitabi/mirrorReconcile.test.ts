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
  pruneMirrorRowsForDeletedPoints: vi.fn(),
  reconcileMirrorAfterDiff: vi.fn(),
}))

vi.mock('@/lib/anitabi/source/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/anitabi/source/client')>()
  return {
    // HttpStatusError 是真实类，workflow 用 instanceof 判 403，必须保留原实现。
    HttpStatusError: actual.HttpStatusError,
    fetchJsonWithRetry: workflowMocks.fetchJsonWithRetry,
    fetchTextWithRetry: workflowMocks.fetchTextWithRetry,
  }
})

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

type TxPrismaMock = {
  mapImageMirrorState: {
    updateMany: ReturnType<typeof vi.fn>
    deleteMany: ReturnType<typeof vi.fn>
    upsert: ReturnType<typeof vi.fn>
  }
}

type WorkflowTxPrismaMock = {
  mapImageMirrorState: {
    deleteMany: ReturnType<typeof vi.fn>
  }
  anitabiPoint: {
    deleteMany: ReturnType<typeof vi.fn>
  }
}

function createPrismaMock(options: { failTxUpsertAt?: number } = {}) {
  let txUpsertCount = 0
  const tx: TxPrismaMock = {
    mapImageMirrorState: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockImplementation(async () => {
        txUpsertCount += 1
        if (options.failTxUpsertAt === txUpsertCount) {
          throw new Error('tx upsert failed')
        }
        return {}
      }),
    },
  }

  return {
    mapImageMirrorState: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (callback: (tx: TxPrismaMock) => unknown) => callback(tx)),
    __tx: tx,
  }
}

function createWorkflowDeps(options: {
  existingPointRows?: Array<{ id: string; image: string | null }>
} = {}): AnitabiApiDeps {
  const tx: WorkflowTxPrismaMock = {
    mapImageMirrorState: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    anitabiPoint: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }

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
            meta: { pointsLength: 0, lastCheckedAt: null },
          },
        ]),
        findUnique: vi.fn().mockResolvedValue({
          cover: 'https://image.anitabi.cn/bangumi/1/old.jpg',
        }),
        upsert: vi.fn().mockResolvedValue({}),
        // 检查点（sourceModifiedMs / lastCheckedAt）延后到所有点位写入与删除
        // 都有结果之后，由单独的 update 提交。
        update: vi.fn().mockResolvedValue({}),
      },
      anitabiBangumiMeta: {
        upsert: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
      anitabiPoint: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue(options.existingPointRows ?? []),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      anitabiSourceCursor: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockImplementation(async (input: unknown) => {
        if (typeof input === 'function') {
          return input(tx)
        }
        if (Array.isArray(input)) {
          return Promise.all(input)
        }
        return input
      }),
      __tx: tx,
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

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.mapImageMirrorState.updateMany).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.upsert).not.toHaveBeenCalled()
    expect(prisma.__tx.mapImageMirrorState.updateMany).toHaveBeenCalledWith({
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
    const variantLabels = variants.map((variant) => variant.label)
    const expectedKeys = await expectedJpegKeys(variants.map((variant) => variant.url))

    expect(prisma.__tx.mapImageMirrorState.deleteMany).toHaveBeenCalledWith({
      where: {
        sourceType: 'bangumi-cover',
        sourceId: '123',
        variant: {
          notIn: variantLabels,
        },
      },
    })
    expect(prisma.__tx.mapImageMirrorState.upsert).toHaveBeenCalledTimes(variants.length)
    for (const [index, variant] of variants.entries()) {
      expect(prisma.__tx.mapImageMirrorState.upsert).toHaveBeenNthCalledWith(index + 1, {
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

  it('skips reset and upsert when the next cover URL has no supported variants', async () => {
    const prisma = createPrismaMock()

    await reconcileMirrorAfterDiff(prisma as never, {
      bangumiChanges: [
        {
          id: 123,
          field: 'cover',
          oldValue: 'https://image.anitabi.cn/bangumi/123/old.jpg',
          newValue: 'https://example.com/unsupported.jpg',
        },
      ],
      pointChanges: [],
    })

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.updateMany).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.upsert).not.toHaveBeenCalled()
    expect(prisma.__tx.mapImageMirrorState.updateMany).not.toHaveBeenCalled()
    expect(prisma.__tx.mapImageMirrorState.upsert).not.toHaveBeenCalled()
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

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.updateMany).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.upsert).not.toHaveBeenCalled()
    expect(prisma.__tx.mapImageMirrorState.updateMany).not.toHaveBeenCalled()
    expect(prisma.__tx.mapImageMirrorState.upsert).not.toHaveBeenCalled()
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

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.mapImageMirrorState.updateMany).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.upsert).not.toHaveBeenCalled()
    expect(prisma.__tx.mapImageMirrorState.updateMany).toHaveBeenCalledWith({
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

    expect(prisma.__tx.mapImageMirrorState.upsert).toHaveBeenCalledTimes(variants.length)
    for (const [index, variant] of variants.entries()) {
      expect(prisma.__tx.mapImageMirrorState.upsert).toHaveBeenNthCalledWith(index + 1, {
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

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.updateMany).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.upsert).not.toHaveBeenCalled()
    expect(prisma.__tx.mapImageMirrorState.updateMany).not.toHaveBeenCalled()
    expect(prisma.__tx.mapImageMirrorState.upsert).not.toHaveBeenCalled()
  })

  it('rejects the source transaction when an upsert fails and avoids direct writes', async () => {
    const prisma = createPrismaMock({ failTxUpsertAt: 2 })

    await expect(
      reconcileMirrorAfterDiff(prisma as never, {
        bangumiChanges: [
          {
            id: 123,
            field: 'cover',
            oldValue: 'https://image.anitabi.cn/bangumi/123/old.jpg',
            newValue: 'https://image.anitabi.cn/bangumi/123/new.jpg',
          },
        ],
        pointChanges: [],
      }),
    ).rejects.toThrow('tx upsert failed')

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.mapImageMirrorState.updateMany).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.deleteMany).not.toHaveBeenCalled()
    expect(prisma.mapImageMirrorState.upsert).not.toHaveBeenCalled()
    expect(prisma.__tx.mapImageMirrorState.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.__tx.mapImageMirrorState.deleteMany).toHaveBeenCalledTimes(1)
    expect(prisma.__tx.mapImageMirrorState.upsert).toHaveBeenCalledTimes(2)
  })
})

describe('runAnitabiSync mirror reconcile hook', () => {
  const originalFlag = process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED
  const originalInterval = process.env.ANITABI_SYNC_MIN_INTERVAL_MS
  const originalRatio = process.env.ANITABI_SYNC_MAX_POINT_DELETION_RATIO

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    // 端点收敛后每个作品只发两个请求：/lite 然后 /points/detail。
    // 库内 sourceModifiedMs=1 而 /lite 返回 modified=2 → 判定为已变更，会继续取点位。
    //
    // pointsLength: 0 是必需的：本组用例要走到 stale 点位清理，而删除闸门要求上游
    // 明确声明点位数（字段缺失时一律拒删，见 syncGuards.test.ts）。这里声明 0
    // 表示「上游确实说没有点位了」，是真实删除场景而非响应不完整。
    workflowMocks.fetchJsonWithRetry
      .mockResolvedValueOnce({
        id: 1,
        cn: 'Work',
        title: 'Work',
        cover: 'https://image.anitabi.cn/bangumi/1/new.jpg',
        modified: 2,
        pointsLength: 0,
        imagesLength: 0,
      })
      .mockResolvedValueOnce([])
    workflowMocks.fetchTextWithRetry.mockResolvedValue(null)
    workflowMocks.writeRawJson.mockResolvedValue(undefined)
    workflowMocks.writeRawText.mockResolvedValue(undefined)
    workflowMocks.enqueueMapTranslationTasksForBangumiIds.mockResolvedValue(null)
    workflowMocks.pruneMirrorRowsForDeletedPoints.mockResolvedValue(undefined)
    process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED = '1'
    // 生产默认每次上游请求间隔 1s，测试里不需要真等。
    process.env.ANITABI_SYNC_MIN_INTERVAL_MS = '0'
    // 本组用例验的是 stale 点位清理链路本身，fixture 刻意让上游返回空集。
    // 生产默认有 20% 删除比例闸门（见 syncGuards.test.ts），这里显式关掉，
    // 否则删除会被闸门正确拦下、测不到清理逻辑。
    process.env.ANITABI_SYNC_MAX_POINT_DELETION_RATIO = '1'
  })

  afterEach(() => {
    if (originalFlag == null) delete process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED
    else process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED = originalFlag
    if (originalInterval == null) delete process.env.ANITABI_SYNC_MIN_INTERVAL_MS
    else process.env.ANITABI_SYNC_MIN_INTERVAL_MS = originalInterval
    if (originalRatio == null) delete process.env.ANITABI_SYNC_MAX_POINT_DELETION_RATIO
    else process.env.ANITABI_SYNC_MAX_POINT_DELETION_RATIO = originalRatio
    vi.doUnmock('@/lib/anitabi/sync/mirrorReconcile')
    vi.restoreAllMocks()
  })

  it('warns and keeps sync successful when reconcile fails', async () => {
    const deps = createWorkflowDeps()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('mirror boom')

    workflowMocks.reconcileMirrorAfterDiff.mockRejectedValue(error)
    vi.doMock('@/lib/anitabi/sync/mirrorReconcile', () => ({
      pruneMirrorRowsForDeletedPoints: workflowMocks.pruneMirrorRowsForDeletedPoints,
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
      '[anitabi/sync] mirror reconciliation failed for bangumi 1; '
        + 'checkpoint held back so the next round retries',
      error,
    )
  })

  it('skips mirror reconciliation when the flag is disabled', async () => {
    const deps = createWorkflowDeps()

    process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED = '0'
    workflowMocks.reconcileMirrorAfterDiff.mockResolvedValue(undefined)
    vi.doMock('@/lib/anitabi/sync/mirrorReconcile', () => ({
      pruneMirrorRowsForDeletedPoints: workflowMocks.pruneMirrorRowsForDeletedPoints,
      reconcileMirrorAfterDiff: workflowMocks.reconcileMirrorAfterDiff,
    }))

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'delta' })

    expect(report.status).toBe('ok')
    expect(workflowMocks.pruneMirrorRowsForDeletedPoints).not.toHaveBeenCalled()
    expect(workflowMocks.reconcileMirrorAfterDiff).not.toHaveBeenCalled()
  })

  it('prunes mirror rows and deletes stale points in one transaction when the flag is enabled', async () => {
    const deps = createWorkflowDeps({
      existingPointRows: [
        {
          id: '1:point-1',
          image: 'https://image.anitabi.cn/points/old.jpg',
        },
      ],
    })

    workflowMocks.reconcileMirrorAfterDiff.mockResolvedValue(undefined)
    vi.doMock('@/lib/anitabi/sync/mirrorReconcile', () => ({
      pruneMirrorRowsForDeletedPoints: workflowMocks.pruneMirrorRowsForDeletedPoints,
      reconcileMirrorAfterDiff: workflowMocks.reconcileMirrorAfterDiff,
    }))

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'delta' })
    const tx = (deps.prisma as typeof deps.prisma & { __tx: WorkflowTxPrismaMock }).__tx

    expect(report.status).toBe('ok')
    expect(deps.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(workflowMocks.pruneMirrorRowsForDeletedPoints).toHaveBeenCalledWith(tx, [
      '1:point-1',
    ])
    expect(tx.anitabiPoint.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['1:point-1'] },
      },
    })
    expect(deps.prisma.anitabiPoint.deleteMany).not.toHaveBeenCalled()
  })

  it('warns and keeps sync successful when the stale-point cleanup transaction fails', async () => {
    const deps = createWorkflowDeps({
      existingPointRows: [
        {
          id: '1:point-1',
          image: 'https://image.anitabi.cn/points/old.jpg',
        },
      ],
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('cleanup boom')

    workflowMocks.pruneMirrorRowsForDeletedPoints.mockRejectedValue(error)
    workflowMocks.reconcileMirrorAfterDiff.mockResolvedValue(undefined)
    vi.doMock('@/lib/anitabi/sync/mirrorReconcile', () => ({
      pruneMirrorRowsForDeletedPoints: workflowMocks.pruneMirrorRowsForDeletedPoints,
      reconcileMirrorAfterDiff: workflowMocks.reconcileMirrorAfterDiff,
    }))

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'delta' })
    const tx = (deps.prisma as typeof deps.prisma & { __tx: WorkflowTxPrismaMock }).__tx

    expect(report.status).toBe('ok')
    expect(workflowMocks.pruneMirrorRowsForDeletedPoints).toHaveBeenCalledWith(tx, [
      '1:point-1',
    ])
    expect(tx.anitabiPoint.deleteMany).not.toHaveBeenCalled()
    expect(deps.prisma.anitabiPoint.deleteMany).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[anitabi/sync] mirror cleanup failed for deleted points in bangumi 1; '
        + 'checkpoint held back so the next round retries',
      error,
    )
  })

  it('deletes stale points without mirror cleanup when the flag is disabled', async () => {
    const deps = createWorkflowDeps({
      existingPointRows: [
        {
          id: '1:point-1',
          image: 'https://image.anitabi.cn/points/old.jpg',
        },
      ],
    })

    process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED = '0'
    workflowMocks.reconcileMirrorAfterDiff.mockResolvedValue(undefined)
    vi.doMock('@/lib/anitabi/sync/mirrorReconcile', () => ({
      pruneMirrorRowsForDeletedPoints: workflowMocks.pruneMirrorRowsForDeletedPoints,
      reconcileMirrorAfterDiff: workflowMocks.reconcileMirrorAfterDiff,
    }))

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'delta' })

    expect(report.status).toBe('ok')
    expect(workflowMocks.pruneMirrorRowsForDeletedPoints).not.toHaveBeenCalled()
    expect(workflowMocks.reconcileMirrorAfterDiff).not.toHaveBeenCalled()
    expect(deps.prisma.$transaction).not.toHaveBeenCalled()
    expect(deps.prisma.anitabiPoint.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['1:point-1'] },
      },
    })
  })
})
