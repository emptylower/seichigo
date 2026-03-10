import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTranslationTaskStatsForAdmin: vi.fn(),
  approveBatchMapTranslationTasks: vi.fn(),
  approveTranslationTaskById: vi.fn(),
  executeTranslationTasks: vi.fn(),
  enqueueMapTranslationTasksForBackfill: vi.fn(),
  getTranslationMapSummary: vi.fn(),
}))

vi.mock('@/lib/translation/adminDashboard', () => ({
  getTranslationTaskStatsForAdmin: (...args: any[]) =>
    mocks.getTranslationTaskStatsForAdmin(...args),
}))

vi.mock('@/lib/translation/adminApproval', () => ({
  approveBatchMapTranslationTasks: (...args: any[]) =>
    mocks.approveBatchMapTranslationTasks(...args),
  approveTranslationTaskById: (...args: any[]) =>
    mocks.approveTranslationTaskById(...args),
}))

vi.mock('@/lib/translation/adminExecution', () => ({
  executeTranslationTasks: (...args: any[]) =>
    mocks.executeTranslationTasks(...args),
}))

vi.mock('@/lib/translation/mapTaskEnqueue', () => ({
  enqueueMapTranslationTasksForBackfill: (...args: any[]) =>
    mocks.enqueueMapTranslationTasksForBackfill(...args),
}))

vi.mock('@/lib/translation/adminMapSummary', () => ({
  getTranslationMapSummary: (...args: any[]) =>
    mocks.getTranslationMapSummary(...args),
}))

function createPrismaMock(readyTasks: Array<{ id: string }> = []) {
  return {
    translationTask: {
      findMany: vi.fn().mockImplementation((args?: { take?: number }) =>
        Promise.resolve(
          typeof args?.take === 'number' ? readyTasks.slice(0, args.take) : readyTasks
        )
      ),
    },
  }
}

describe('runMapOps advance_one_key', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    mocks.approveBatchMapTranslationTasks.mockResolvedValue({
      total: 0,
      approved: 0,
      skipped: 0,
      failed: 0,
      results: [],
    })
    mocks.approveTranslationTaskById.mockResolvedValue({ ok: true })
  })

  it('tops up missing point tasks before the pending queue is fully drained', async () => {
    const prisma = createPrismaMock()

    mocks.getTranslationTaskStatsForAdmin.mockImplementation(
      ({ entityType }: { entityType: string }) =>
        Promise.resolve(
          entityType === 'anitabi_point'
            ? { pending: 20, processing: 0, ready: 0, failed: 0 }
            : { pending: 0, processing: 0, ready: 0, failed: 0 }
        )
    )
    mocks.getTranslationMapSummary.mockResolvedValue({
      targetLanguage: 'all',
      bangumiRemaining: 0,
      pointRemaining: 3200,
    })
    mocks.executeTranslationTasks.mockImplementation(
      (_prisma: unknown, input: { entityType?: string; statusScope?: string }) => {
        if (input.statusScope === 'pending' && input.entityType === 'anitabi_point') {
          return Promise.resolve({
            reclaimedProcessing: 0,
            total: 20,
            processed: 20,
            success: 18,
            failed: 2,
            skipped: 0,
            results: [
              { taskId: 'point-1', status: 'ready' },
              { taskId: 'point-2', status: 'failed', error: 'provider error' },
            ],
          })
        }

        return Promise.resolve({
          reclaimedProcessing: 0,
          total: 0,
          processed: 0,
          success: 0,
          failed: 0,
          skipped: 0,
          results: [],
        })
      }
    )
    mocks.enqueueMapTranslationTasksForBackfill.mockResolvedValue({
      scanned: 200,
      enqueued: 640,
      updated: 0,
      nextCursor: 'point-cursor-200',
      done: false,
    })

    const { runMapOps } = await import('@/lib/translation/mapOps')
    const result = await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      maxRounds: 1,
    })

    expect(mocks.enqueueMapTranslationTasksForBackfill).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueMapTranslationTasksForBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'anitabi_point',
        mode: 'missing',
        limit: 200,
        cursor: null,
      })
    )
    expect(mocks.executeTranslationTasks).not.toHaveBeenCalled()

    expect(result.done).toBe(false)
    expect(result.message).toContain('低水位自动补队')
    expect(result.pointBackfillCursor).toBe('point-cursor-200')
    expect(result.snapshot.oneKey).toMatchObject({
      pointBackfilledEnqueued: 640,
      roundProcessed: 640,
    })
  })

  it('forces a missing-task refill when no failed or pending tasks can be executed', async () => {
    const prisma = createPrismaMock()

    mocks.getTranslationTaskStatsForAdmin.mockImplementation(
      ({ entityType }: { entityType: string }) =>
        Promise.resolve(
          entityType === 'anitabi_point'
            ? { pending: 0, processing: 500, ready: 0, failed: 0 }
            : { pending: 0, processing: 0, ready: 0, failed: 0 }
        )
    )
    mocks.getTranslationMapSummary.mockResolvedValue({
      targetLanguage: 'all',
      bangumiRemaining: 0,
      pointRemaining: 1500,
    })
    mocks.executeTranslationTasks.mockResolvedValue({
      reclaimedProcessing: 0,
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      results: [],
    })
    mocks.enqueueMapTranslationTasksForBackfill.mockResolvedValue({
      scanned: 200,
      enqueued: 500,
      updated: 40,
      nextCursor: 'point-cursor-200',
      done: false,
    })

    const { runMapOps } = await import('@/lib/translation/mapOps')
    const result = await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      maxRounds: 1,
    })

    expect(mocks.executeTranslationTasks).toHaveBeenCalledTimes(4)
    expect(mocks.enqueueMapTranslationTasksForBackfill).toHaveBeenCalledTimes(1)
    expect(result.message).toContain('补队完成')
    expect(result.message).not.toContain('待翻译推进')
    expect(result.snapshot.oneKey).toMatchObject({
      pointBackfilledEnqueued: 500,
      pointBackfilledUpdated: 40,
      roundProcessed: 540,
    })
  })

  it('keeps advancing the backfill cursor without tripping stagnation when sparse gaps are later in the dataset', async () => {
    const prisma = createPrismaMock()

    mocks.getTranslationTaskStatsForAdmin.mockImplementation(
      ({ entityType }: { entityType: string }) =>
        Promise.resolve(
          entityType === 'anitabi_point'
            ? { pending: 0, processing: 0, ready: 0, failed: 0 }
            : { pending: 0, processing: 0, ready: 0, failed: 0 }
        )
    )
    mocks.getTranslationMapSummary.mockResolvedValue({
      targetLanguage: 'all',
      bangumiRemaining: 0,
      pointRemaining: 1736,
    })
    mocks.executeTranslationTasks.mockResolvedValue({
      reclaimedProcessing: 0,
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      results: [],
    })
    for (let index = 1; index <= 9; index += 1) {
      mocks.enqueueMapTranslationTasksForBackfill.mockResolvedValueOnce({
        scanned: 500,
        enqueued: 0,
        updated: 0,
        nextCursor: `point-cursor-${index}`,
        done: false,
      })
    }

    const { runMapOps } = await import('@/lib/translation/mapOps')
    const result = await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      maxRounds: 3,
    })

    expect(mocks.enqueueMapTranslationTasksForBackfill).toHaveBeenCalledTimes(1)
    expect(result.done).toBe(false)
    expect(result.continuation).toBeTruthy()
    expect(result.message).toContain('继续向后扫描')
    expect(result.snapshot.oneKey).toMatchObject({
      pointBackfilledEnqueued: 0,
      stagnationCount: 0,
    })
    expect(result.pointBackfillCursor).toBe('point-cursor-1')
  })

  it('runs pending execution as a single heavy step when backlog is already above low water', async () => {
    const prisma = createPrismaMock()

    mocks.getTranslationTaskStatsForAdmin.mockImplementation(
      ({ entityType }: { entityType: string }) =>
        Promise.resolve(
          entityType === 'anitabi_point'
            ? { pending: 360, processing: 0, ready: 0, failed: 0 }
            : { pending: 0, processing: 0, ready: 0, failed: 0 }
        )
    )
    mocks.getTranslationMapSummary.mockResolvedValue({
      targetLanguage: 'all',
      bangumiRemaining: 0,
      pointRemaining: 0,
    })
    mocks.executeTranslationTasks.mockImplementation(
      (_prisma: unknown, input: { entityType?: string; statusScope?: string; limit?: number; concurrency?: number }) => {
        if (input.statusScope === 'pending' && input.entityType === 'anitabi_point') {
          return Promise.resolve({
            reclaimedProcessing: 0,
            total: 6,
            processed: 6,
            success: 5,
            failed: 1,
            skipped: 0,
            results: [
              { taskId: 'point-1', status: 'ready' },
              { taskId: 'point-2', status: 'failed', error: 'provider error' },
            ],
          })
        }

        return Promise.resolve({
          reclaimedProcessing: 0,
          total: 0,
          processed: 0,
          success: 0,
          failed: 0,
          skipped: 0,
          results: [],
        })
      }
    )

    const { runMapOps } = await import('@/lib/translation/mapOps')
    const result = await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      maxRounds: 1,
    })

    expect(mocks.enqueueMapTranslationTasksForBackfill).not.toHaveBeenCalled()
    expect(mocks.executeTranslationTasks).toHaveBeenCalledTimes(4)
    expect(mocks.executeTranslationTasks.mock.calls).toEqual(
      expect.arrayContaining([
        [
          prisma,
          expect.objectContaining({
            entityType: 'anitabi_point',
            statusScope: 'pending',
            limit: 6,
            concurrency: 1,
          }),
        ],
      ])
    )
    expect(result.done).toBe(false)
    expect(result.continuation).toBeTruthy()
    expect(result.message).toContain('待翻译推进')
    expect(result.snapshot.oneKey).toMatchObject({
      pointBackfilledEnqueued: 0,
      pointQueueOpen: 360,
      pointUnqueuedEstimate: 0,
      roundProcessed: 6,
      stagnationCount: 0,
    })
  })

  it('uses smaller one-key execution batches on Vercel', async () => {
    process.env.VERCEL = '1'

    const prisma = createPrismaMock()

    mocks.getTranslationTaskStatsForAdmin.mockImplementation(
      ({ entityType }: { entityType: string }) =>
        Promise.resolve(
          entityType === 'anitabi_point'
            ? { pending: 360, processing: 0, ready: 0, failed: 0 }
            : { pending: 0, processing: 0, ready: 0, failed: 0 }
        )
    )
    mocks.getTranslationMapSummary.mockResolvedValue({
      targetLanguage: 'all',
      bangumiRemaining: 0,
      pointRemaining: 0,
    })
    mocks.executeTranslationTasks.mockImplementation(
      (_prisma: unknown, input: { entityType?: string; statusScope?: string }) => {
        if (input.statusScope === 'pending' && input.entityType === 'anitabi_point') {
          return Promise.resolve({
            reclaimedProcessing: 0,
            total: 4,
            processed: 4,
            success: 4,
            failed: 0,
            skipped: 0,
            results: [{ taskId: 'point-1', status: 'ready' }],
          })
        }

        return Promise.resolve({
          reclaimedProcessing: 0,
          total: 0,
          processed: 0,
          success: 0,
          failed: 0,
          skipped: 0,
          results: [],
        })
      }
    )

    const { runMapOps } = await import('@/lib/translation/mapOps')
    await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      maxRounds: 1,
    })

    expect(mocks.executeTranslationTasks.mock.calls).toEqual(
      expect.arrayContaining([
        [
          prisma,
          expect.objectContaining({
            entityType: 'anitabi_point',
            statusScope: 'pending',
            limit: 4,
            concurrency: 1,
          }),
        ],
      ])
    )
  })

  it('does not report done while ready map tasks still need approval', async () => {
    const prisma = createPrismaMock(
      Array.from({ length: 100 }, (_value, index) => ({
        id: `ready-${index + 1}`,
      }))
    )
    let statsCall = 0

    mocks.getTranslationTaskStatsForAdmin.mockImplementation(
      ({ entityType }: { entityType: string }) => {
        const phase = Math.floor(statsCall / 2)
        statsCall += 1

        if (entityType === 'anitabi_point') {
          const ready = phase === 0 ? 120 : 90
          return Promise.resolve({
            pending: 0,
            processing: 0,
            ready,
            failed: 0,
          })
        }

        return Promise.resolve({
          pending: 0,
          processing: 0,
          ready: 0,
          failed: 0,
        })
      }
    )
    mocks.getTranslationMapSummary.mockResolvedValue({
      targetLanguage: 'all',
      bangumiRemaining: 0,
      pointRemaining: 0,
    })
    mocks.executeTranslationTasks.mockResolvedValue({
      reclaimedProcessing: 0,
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      results: [],
    })
    mocks.approveBatchMapTranslationTasks.mockResolvedValue({
      total: 30,
      approved: 30,
      skipped: 0,
      failed: 0,
      results: Array.from({ length: 30 }, (_value, index) => ({
        taskId: `ready-${index + 1}`,
        status: 'approved',
      })),
    })

    const { runMapOps } = await import('@/lib/translation/mapOps')
    const result = await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      maxRounds: 1,
    })

    expect(result.done).toBe(false)
    expect(result.continuation).toBeTruthy()
    expect(result.message).toContain('自动审核')
    expect(mocks.approveBatchMapTranslationTasks).toHaveBeenCalledTimes(1)
    expect(result.snapshot.oneKey).toMatchObject({
      readyTotal: 90,
      approvedTotal: 30,
    })
  })

  it('pauses after repeated approval failures without effective progress', async () => {
    const prisma = createPrismaMock(
      Array.from({ length: 10 }, (_value, index) => ({
        id: `ready-${index + 1}`,
      }))
    )

    mocks.getTranslationTaskStatsForAdmin.mockImplementation(
      ({ entityType }: { entityType: string }) =>
        Promise.resolve(
          entityType === 'anitabi_point'
            ? { pending: 0, processing: 0, ready: 10, failed: 0 }
            : { pending: 0, processing: 0, ready: 0, failed: 0 }
        )
    )
    mocks.getTranslationMapSummary.mockResolvedValue({
      targetLanguage: 'all',
      bangumiRemaining: 0,
      pointRemaining: 0,
    })
    mocks.executeTranslationTasks.mockResolvedValue({
      reclaimedProcessing: 0,
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      results: [],
    })
    mocks.approveBatchMapTranslationTasks.mockResolvedValue({
      total: 10,
      approved: 0,
      skipped: 0,
      failed: 10,
      results: Array.from({ length: 10 }, (_value, index) => ({
        taskId: `ready-${index + 1}`,
        status: 'failed',
        error: 'approve failed',
      })),
    })

    const { runMapOps } = await import('@/lib/translation/mapOps')
    let continuation: Record<string, unknown> | null = null
    let result = await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      continuation,
    })

    continuation = result.continuation
    result = await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      continuation,
    })

    continuation = result.continuation
    result = await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      continuation,
    })

    expect(result.done).toBe(false)
    expect(result.continuation).toBeNull()
    expect(result.message).toContain('自动推进暂停')
    expect(result.snapshot.errors).toContain('approve failed')
    expect(result.snapshot.oneKey).toMatchObject({
      approvalFailedTotal: 30,
      stagnationCount: 3,
    })
  })

  it('does not pause after three retryable provider-error rounds', async () => {
    const prisma = createPrismaMock()

    mocks.getTranslationTaskStatsForAdmin.mockImplementation(
      ({ entityType }: { entityType: string }) =>
        Promise.resolve(
          entityType === 'anitabi_point'
            ? { pending: 0, processing: 0, ready: 0, failed: 1 }
            : { pending: 0, processing: 0, ready: 0, failed: 0 }
        )
    )
    mocks.getTranslationMapSummary.mockResolvedValue({
      targetLanguage: 'all',
      bangumiRemaining: 0,
      pointRemaining: 0,
    })
    mocks.executeTranslationTasks.mockImplementation(
      (_prisma: unknown, input: { entityType?: string; statusScope?: string }) => {
        if (input.statusScope === 'failed' && input.entityType === 'anitabi_point') {
          return Promise.resolve({
            reclaimedProcessing: 0,
            total: 1,
            processed: 1,
            success: 0,
            failed: 1,
            skipped: 0,
            results: [
              {
                taskId: 'point-1',
                status: 'failed',
                error: 'Gemini API error (503): Service Unavailable',
              },
            ],
          })
        }

        return Promise.resolve({
          reclaimedProcessing: 0,
          total: 0,
          processed: 0,
          success: 0,
          failed: 0,
          skipped: 0,
          results: [],
        })
      }
    )

    const { runMapOps } = await import('@/lib/translation/mapOps')
    let continuation: Record<string, unknown> | null = null
    let result = await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      continuation,
    })

    continuation = result.continuation
    result = await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      continuation,
    })

    continuation = result.continuation
    result = await runMapOps(prisma as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      continuation,
    })

    expect(result.done).toBe(false)
    expect(result.continuation).toBeTruthy()
    expect(result.message).toContain('失败重试')
    expect(result.snapshot.oneKey).toMatchObject({
      stagnationCount: 0,
    })
    expect(result.continuation).toMatchObject({
      retryableStagnationCount: 3,
    })
  })
})
