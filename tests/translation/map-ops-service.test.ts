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

describe('runMapOps advance_one_key', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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
      scanned: 1000,
      enqueued: 640,
      updated: 0,
      nextCursor: 'point-cursor-1000',
      done: false,
    })

    const { runMapOps } = await import('@/lib/translation/mapOps')
    const result = await runMapOps({} as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      maxRounds: 1,
    })

    expect(mocks.enqueueMapTranslationTasksForBackfill).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueMapTranslationTasksForBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'anitabi_point',
        mode: 'missing',
        limit: 1000,
        cursor: null,
      })
    )
    expect(
      mocks.enqueueMapTranslationTasksForBackfill.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.executeTranslationTasks.mock.invocationCallOrder[0]!)

    expect(result.done).toBe(false)
    expect(result.message).toContain('Pending 推进')
    expect(result.message).toContain('低水位自动补队')
    expect(result.pointBackfillCursor).toBe('point-cursor-1000')
    expect(result.snapshot.oneKey).toMatchObject({
      pointBackfilledEnqueued: 640,
      roundProcessed: 1020,
    })
  })

  it('forces a missing-task refill when no failed or pending tasks can be executed', async () => {
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
      scanned: 1000,
      enqueued: 500,
      updated: 40,
      nextCursor: 'point-cursor-1000',
      done: false,
    })

    const { runMapOps } = await import('@/lib/translation/mapOps')
    const result = await runMapOps({} as never, {
      action: 'advance_one_key',
      targetLanguage: 'all',
      maxRounds: 1,
    })

    expect(mocks.executeTranslationTasks).toHaveBeenCalledTimes(4)
    expect(mocks.enqueueMapTranslationTasksForBackfill).toHaveBeenCalledTimes(1)
    expect(result.message).toContain('补队完成')
    expect(result.message).not.toContain('Pending 推进')
    expect(result.snapshot.oneKey).toMatchObject({
      pointBackfilledEnqueued: 500,
      pointBackfilledUpdated: 40,
      roundProcessed: 1000,
    })
  })
})
