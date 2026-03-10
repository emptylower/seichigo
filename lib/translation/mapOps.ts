import type { PrismaClient } from '@prisma/client'
import {
  getTranslationTaskStatsForAdmin,
} from '@/lib/translation/adminDashboard'
import {
  approveBatchMapTranslationTasks,
  approveTranslationTaskById,
} from '@/lib/translation/adminApproval'
import { executeTranslationTasks } from '@/lib/translation/adminExecution'
import {
  enqueueMapTranslationTasksForBackfill,
  type MapTaskEnqueueMode,
} from '@/lib/translation/mapTaskEnqueue'
import {
  getTranslationMapSummary,
  type MapSummaryTargetLanguage,
} from '@/lib/translation/adminMapSummary'
import {
  appendUniqueMessages,
  calcCompletionPercent,
  collectErrorMessages,
  emptyContinuation,
  type ExecuteStatusScope,
  type MapExecutionSummary,
  type MapOpsContinuation,
  type MapOpsResult,
  type MapOpsSnapshot,
  type MapQueueSnapshot,
  type RunMapOpsInput,
} from '@/lib/translation/mapOpsShared'

async function loadStats(
  prisma: PrismaClient,
  entityType: 'anitabi_bangumi' | 'anitabi_point',
  targetLanguage: MapSummaryTargetLanguage
) {
  return getTranslationTaskStatsForAdmin({
    entityType,
    targetLanguage,
  })
}

async function loadMapQueueSnapshot(
  prisma: PrismaClient,
  targetLanguage: MapSummaryTargetLanguage
): Promise<MapQueueSnapshot> {
  const [bangumiStats, pointStats, summary] = await Promise.all([
    loadStats(prisma, 'anitabi_bangumi', targetLanguage),
    loadStats(prisma, 'anitabi_point', targetLanguage),
    getTranslationMapSummary(prisma, targetLanguage),
  ])

  const bangumiQueueOpen =
    Number(bangumiStats.pending || 0) +
    Number(bangumiStats.processing || 0) +
    Number(bangumiStats.ready || 0) +
    Number(bangumiStats.failed || 0)
  const pointQueueOpen =
    Number(pointStats.pending || 0) +
    Number(pointStats.processing || 0) +
    Number(pointStats.ready || 0) +
    Number(pointStats.failed || 0)
  const bangumiPendingLike =
    Number(bangumiStats.pending || 0) +
    Number(bangumiStats.processing || 0) +
    Number(bangumiStats.failed || 0)
  const pointPendingLike =
    Number(pointStats.pending || 0) +
    Number(pointStats.processing || 0) +
    Number(pointStats.failed || 0)
  const langMultiplier = targetLanguage === 'all' ? 2 : 1

  return {
    bangumiRemaining: summary.bangumiRemaining,
    pointRemaining: summary.pointRemaining,
    bangumiQueueOpen,
    pointQueueOpen,
    bangumiPendingLike,
    pointPendingLike,
    estimatedUnfinishedTasks:
      bangumiPendingLike +
      pointPendingLike +
      (summary.bangumiRemaining + summary.pointRemaining) * langMultiplier,
  }
}

async function executeMapRound(
  prisma: PrismaClient,
  input: {
    targetLanguage: MapSummaryTargetLanguage
    statusScope: ExecuteStatusScope
    limitPerType: number
    concurrency: number
    q?: string | null
  }
): Promise<MapExecutionSummary> {
  const summary: MapExecutionSummary = {
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    reclaimedProcessing: 0,
    errorMessages: [],
  }

  for (const entityType of ['anitabi_bangumi', 'anitabi_point'] as const) {
    const result = await executeTranslationTasks(prisma, {
      entityType,
      targetLanguage:
        input.targetLanguage === 'all' ? undefined : input.targetLanguage,
      q: input.q,
      limit: input.limitPerType,
      includeFailed: input.statusScope !== 'pending',
      statusScope: input.statusScope,
      concurrency: input.concurrency,
    })
    summary.total += result.total
    summary.processed += result.processed
    summary.success += result.success
    summary.failed += result.failed
    summary.skipped += result.skipped
    summary.reclaimedProcessing += result.reclaimedProcessing
    summary.errorMessages = appendUniqueMessages(
      summary.errorMessages,
      collectErrorMessages(result.results)
    )
  }

  return summary
}

async function loadReadyTasks(
  prisma: PrismaClient,
  input: {
    limit: number
    targetLanguage: MapSummaryTargetLanguage
    mapOnly?: boolean
  }
) {
  return prisma.translationTask.findMany({
    where: {
      status: 'ready',
      ...(input.targetLanguage !== 'all'
        ? { targetLanguage: input.targetLanguage }
        : {}),
      ...(input.mapOnly
        ? { entityType: { in: ['anitabi_bangumi', 'anitabi_point'] } }
        : {}),
    },
    orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
    take: input.limit,
    select: {
      id: true,
      entityType: true,
    },
  })
}

const ONE_KEY_LOW_WATER_PENDING_LIKE = {
  anitabi_bangumi: 40,
  anitabi_point: 300,
} as const

const ONE_KEY_BACKFILL_SCAN_LIMIT = {
  anitabi_bangumi: 100,
  anitabi_point: 1000,
} as const

type OneKeyBackfillSummary = {
  triggered: boolean
  scanned: number
  enqueued: number
  updated: number
  detail: string | null
}

function shouldBackfillEntity(
  queue: MapQueueSnapshot,
  entityType: 'anitabi_bangumi' | 'anitabi_point',
  force = false
) {
  const remaining =
    entityType === 'anitabi_bangumi'
      ? Number(queue.bangumiRemaining || 0)
      : Number(queue.pointRemaining || 0)
  if (remaining <= 0) return false
  if (force) return true

  const pendingLike =
    entityType === 'anitabi_bangumi'
      ? Number(queue.bangumiPendingLike || 0)
      : Number(queue.pointPendingLike || 0)

  return pendingLike < ONE_KEY_LOW_WATER_PENDING_LIKE[entityType]
}

async function backfillOneKeyLowWater(
  prisma: PrismaClient,
  continuation: MapOpsContinuation,
  queue: MapQueueSnapshot,
  options: { force?: boolean } = {}
): Promise<OneKeyBackfillSummary> {
  const force = options.force === true
  const detailParts: string[] = []
  let scanned = 0
  let enqueued = 0
  let updated = 0

  if (shouldBackfillEntity(queue, 'anitabi_bangumi', force)) {
    const result = await enqueueMapTranslationTasksForBackfill({
      prisma,
      entityType: 'anitabi_bangumi',
      targetLanguages: ['en', 'ja'],
      mode: 'missing',
      limit: ONE_KEY_BACKFILL_SCAN_LIMIT.anitabi_bangumi,
      cursor: continuation.bangumiBackfillCursor,
    })
    continuation.bangumiBackfillCursor = result.done
      ? null
      : result.nextCursor
    continuation.bangumiBackfilledTotal += result.enqueued + result.updated
    continuation.bangumiBatch += 1
    continuation.success += result.enqueued
    continuation.skipped += result.updated
    scanned += result.scanned
    enqueued += result.enqueued
    updated += result.updated
    detailParts.push(`作品 新建 ${result.enqueued}/更新 ${result.updated}`)
  }

  if (shouldBackfillEntity(queue, 'anitabi_point', force)) {
    const result = await enqueueMapTranslationTasksForBackfill({
      prisma,
      entityType: 'anitabi_point',
      targetLanguages: ['en', 'ja'],
      mode: 'missing',
      limit: ONE_KEY_BACKFILL_SCAN_LIMIT.anitabi_point,
      cursor: continuation.pointBackfillCursor,
    })
    continuation.pointBackfillCursor = result.done
      ? null
      : result.nextCursor
    continuation.pointBackfilledEnqueued += result.enqueued
    continuation.pointBackfilledUpdated += result.updated
    continuation.success += result.enqueued
    continuation.skipped += result.updated
    scanned += result.scanned
    enqueued += result.enqueued
    updated += result.updated
    detailParts.push(`点位 新建 ${result.enqueued}/更新 ${result.updated}`)
  }

  return {
    triggered: detailParts.length > 0,
    scanned,
    enqueued,
    updated,
    detail:
      detailParts.length > 0
        ? `${force ? '补队完成' : '低水位自动补队'}：${detailParts.join('，')}`
        : null,
  }
}

function buildOneKeySnapshot(
  continuation: MapOpsContinuation,
  queue: MapQueueSnapshot,
  targetLanguage: MapSummaryTargetLanguage,
  roundProcessed: number,
  detail: string,
  currentStep: number,
  totalSteps: number
): MapOpsSnapshot {
  const langMultiplier = targetLanguage === 'all' ? 2 : 1
  const pointUnqueuedEstimate =
    queue.pointRemaining === null ? null : Math.max(0, queue.pointRemaining * langMultiplier)
  const pointUnfinishedTotal =
    queue.pointQueueOpen === null || pointUnqueuedEstimate === null
      ? null
      : queue.pointQueueOpen + pointUnqueuedEstimate

  return {
    processed: continuation.processed,
    success: continuation.success,
    failed: continuation.failed,
    reclaimed: continuation.reclaimed,
    skipped: continuation.skipped,
    currentStep,
    totalSteps,
    detail,
    errors: continuation.errors,
    oneKey: {
      bangumiBatch: continuation.bangumiBatch,
      bangumiBackfilledTotal: continuation.bangumiBackfilledTotal,
      bangumiRemaining: queue.bangumiRemaining,
      pointBackfilledEnqueued: continuation.pointBackfilledEnqueued,
      pointBackfilledUpdated: continuation.pointBackfilledUpdated,
      pointBackfilledTotal:
        continuation.pointBackfilledEnqueued + continuation.pointBackfilledUpdated,
      pointQueueOpen: queue.pointQueueOpen,
      pointUnqueuedEstimate,
      pointUnfinishedTotal,
      roundProcessed,
      totalProcessed: continuation.processed,
      estimatedTotal: queue.estimatedUnfinishedTasks,
      completionPercent: calcCompletionPercent(
        continuation.processed,
        queue.estimatedUnfinishedTasks
      ),
    },
  }
}

export async function runMapOps(
  prisma: PrismaClient,
  input: RunMapOpsInput
): Promise<MapOpsResult> {
  if (input.action === 'backfill_once') {
    const entityType = input.entityType || 'anitabi_bangumi'
    const result = await enqueueMapTranslationTasksForBackfill({
      prisma,
      entityType,
      targetLanguages: ['en', 'ja'],
      mode: input.mode || 'all',
      limit: 1000,
      cursor:
        entityType === 'anitabi_bangumi'
          ? input.continuation?.bangumiBackfillCursor || null
          : input.continuation?.pointBackfillCursor || null,
    })

    return {
      ok: true,
      action: input.action,
      done: result.done,
      message: `${entityType} 回填完成：扫描 ${result.scanned}，新建 ${result.enqueued}，更新 ${result.updated}`,
      bangumiBackfillCursor:
        entityType === 'anitabi_bangumi'
          ? (result.done ? null : result.nextCursor)
          : input.continuation?.bangumiBackfillCursor || null,
      pointBackfillCursor:
        entityType === 'anitabi_point'
          ? (result.done ? null : result.nextCursor)
          : input.continuation?.pointBackfillCursor || null,
      continuation: null,
      snapshot: {
        processed: result.scanned,
        success: result.enqueued,
        failed: 0,
        reclaimed: 0,
        skipped: result.updated,
        currentStep: 1,
        totalSteps: 1,
        detail: `${entityType} 回填完成：扫描 ${result.scanned}，新建 ${result.enqueued}，更新 ${result.updated}`,
        errors: [],
        oneKey: null,
      },
    }
  }

  if (input.action === 'incremental_refill') {
    const [bangumiResult, pointResult] = await Promise.all([
      enqueueMapTranslationTasksForBackfill({
        prisma,
        entityType: 'anitabi_bangumi',
        targetLanguages: ['en', 'ja'],
        mode: 'stale',
        limit: 1000,
        cursor: null,
      }),
      enqueueMapTranslationTasksForBackfill({
        prisma,
        entityType: 'anitabi_point',
        targetLanguages: ['en', 'ja'],
        mode: 'stale',
        limit: 1000,
        cursor: null,
      }),
    ])

    return {
      ok: true,
      action: input.action,
      done: true,
      message: `增量补队完成：作品 新建 ${bangumiResult.enqueued}/更新 ${bangumiResult.updated}，点位 新建 ${pointResult.enqueued}/更新 ${pointResult.updated}`,
      bangumiBackfillCursor: null,
      pointBackfillCursor: null,
      continuation: null,
      snapshot: {
        processed: bangumiResult.scanned + pointResult.scanned,
        success: bangumiResult.enqueued + pointResult.enqueued,
        failed: 0,
        reclaimed: 0,
        skipped: bangumiResult.updated + pointResult.updated,
        currentStep: 2,
        totalSteps: 2,
        detail: `增量补队完成：作品 新建 ${bangumiResult.enqueued}/更新 ${bangumiResult.updated}，点位 新建 ${pointResult.enqueued}/更新 ${pointResult.updated}`,
        errors: [],
        oneKey: null,
      },
    }
  }

  if (input.action === 'execute_round') {
    const result = await executeMapRound(prisma, {
      targetLanguage: input.targetLanguage,
      statusScope: input.statusScope || 'pending',
      limitPerType: input.limitPerType ?? 20,
      concurrency: input.concurrency ?? 2,
      q: input.q,
    })
    const translationFailed = Math.max(0, result.failed - result.reclaimedProcessing)

    return {
      ok: true,
      action: input.action,
      done: true,
      message: `执行完成：处理 ${result.processed}，成功 ${result.success}，翻译失败 ${translationFailed}，回收 ${result.reclaimedProcessing}，跳过 ${result.skipped}`,
      bangumiBackfillCursor: null,
      pointBackfillCursor: null,
      continuation: null,
      snapshot: {
        processed: result.processed,
        success: result.success,
        failed: translationFailed,
        reclaimed: result.reclaimedProcessing,
        skipped: result.skipped,
        currentStep: 1,
        totalSteps: 1,
        detail: `执行完成：处理 ${result.processed}，成功 ${result.success}，翻译失败 ${translationFailed}，回收 ${result.reclaimedProcessing}，跳过 ${result.skipped}`,
        errors: result.errorMessages,
        oneKey: null,
      },
    }
  }

  if (input.action === 'manual_advance') {
    const rounds = Math.max(1, Math.min(20, Math.floor(input.maxRounds || 10)))
    let processed = 0
    let success = 0
    let failed = 0
    let reclaimed = 0
    let skipped = 0
    let completedRounds = 0
    let errors: string[] = []
    let queueDrained = false

    for (let index = 0; index < rounds; index += 1) {
      const result = await executeMapRound(prisma, {
        targetLanguage: input.targetLanguage,
        statusScope: 'pending',
        limitPerType: 20,
        concurrency: 2,
      })
      if (result.total === 0 || result.processed === 0) {
        queueDrained = true
        break
      }
      completedRounds += 1
      processed += result.processed
      success += result.success
      failed += Math.max(0, result.failed - result.reclaimedProcessing)
      reclaimed += result.reclaimedProcessing
      skipped += result.skipped
      errors = appendUniqueMessages(errors, result.errorMessages)
    }

    return {
      ok: true,
      action: input.action,
      done: true,
      message:
        completedRounds === 0
          ? '当前没有 pending 的地图翻译任务，队列已是最新状态'
          : `手动推进完成：共 ${completedRounds} 轮，处理 ${processed}，成功 ${success}，翻译失败 ${failed}，回收 ${reclaimed}，跳过 ${skipped}${queueDrained ? '（队列已清空）' : ''}`,
      bangumiBackfillCursor: null,
      pointBackfillCursor: null,
      continuation: null,
      snapshot: {
        processed,
        success,
        failed,
        reclaimed,
        skipped,
        currentStep: completedRounds || 1,
        totalSteps: completedRounds || 1,
        detail:
          completedRounds === 0
            ? '当前没有 pending 的地图翻译任务，队列已是最新状态'
            : `手动推进完成：共 ${completedRounds} 轮，处理 ${processed}，成功 ${success}，翻译失败 ${failed}，回收 ${reclaimed}，跳过 ${skipped}${queueDrained ? '（队列已清空）' : ''}`,
        errors,
        oneKey: null,
      },
    }
  }

  if (input.action === 'approve_all_ready') {
    const maxRounds = Math.max(1, Math.min(1000, Math.floor(input.maxRounds || 1000)))
    let processed = 0
    let success = 0
    let failed = 0
    let skipped = 0
    let rounds = 0
    let errors: string[] = []
    let done = false

    for (let round = 1; round <= maxRounds; round += 1) {
      const readyTasks = await loadReadyTasks(prisma, {
        limit: 100,
        targetLanguage: input.targetLanguage,
      })
      if (readyTasks.length === 0) {
        done = true
        break
      }

      rounds = round
      const mapTaskIds = readyTasks
        .filter(
          (task) =>
            task.entityType === 'anitabi_bangumi' ||
            task.entityType === 'anitabi_point'
        )
        .map((task) => task.id)
      const nonMapTaskIds = readyTasks
        .filter(
          (task) =>
            task.entityType !== 'anitabi_bangumi' &&
            task.entityType !== 'anitabi_point'
        )
        .map((task) => task.id)

      if (mapTaskIds.length > 0) {
        const result = await approveBatchMapTranslationTasks(prisma, mapTaskIds)
        processed += result.total
        success += result.approved
        failed += result.failed
        skipped += result.skipped
        errors = appendUniqueMessages(errors, collectErrorMessages(result.results))
      }

      if (nonMapTaskIds.length > 0) {
        const results = await Promise.all(
          nonMapTaskIds.map(async (taskId) => {
            try {
              await approveTranslationTaskById(prisma, taskId)
              return { status: 'approved' as const }
            } catch (error) {
              return {
                status: 'failed' as const,
                error: error instanceof Error ? error.message : '审核失败',
              }
            }
          })
        )
        processed += results.length
        success += results.filter((row) => row.status === 'approved').length
        failed += results.filter((row) => row.status === 'failed').length
        errors = appendUniqueMessages(
          errors,
          results
            .filter((row) => row.status === 'failed')
            .map((row) => row.error || '审核失败')
        )
      }
    }

    return {
      ok: true,
      action: input.action,
      done,
      message: done
        ? `一键审核完成：共 ${rounds} 轮，处理 ${processed}，通过 ${success}，失败 ${failed}，跳过 ${skipped}`
        : `一键审核暂停：共 ${rounds} 轮，处理 ${processed}，通过 ${success}，失败 ${failed}，跳过 ${skipped}`,
      bangumiBackfillCursor: null,
      pointBackfillCursor: null,
      continuation: null,
      snapshot: {
        processed,
        success,
        failed,
        reclaimed: 0,
        skipped,
        currentStep: rounds || 1,
        totalSteps: rounds || 1,
        detail: done
          ? `一键审核完成：共 ${rounds} 轮，处理 ${processed}，通过 ${success}，失败 ${failed}，跳过 ${skipped}`
          : `一键审核暂停：共 ${rounds} 轮，处理 ${processed}，通过 ${success}，失败 ${failed}，跳过 ${skipped}`,
        errors,
        oneKey: null,
      },
    }
  }

  if (input.action === 'approve_sample') {
    const readyTasks = await loadReadyTasks(prisma, {
      limit: 300,
      targetLanguage: input.targetLanguage,
      mapOnly: true,
    })
    if (readyTasks.length === 0) {
      return {
        ok: true,
        action: input.action,
        done: true,
        message: '当前没有可抽检发布的地图 ready 任务',
        bangumiBackfillCursor: null,
        pointBackfillCursor: null,
        continuation: null,
        snapshot: {
          processed: 0,
          success: 0,
          failed: 0,
          reclaimed: 0,
          skipped: 0,
          currentStep: 1,
          totalSteps: 1,
          detail: '当前没有可抽检发布的地图 ready 任务',
          errors: [],
          oneKey: null,
        },
      }
    }

    const sampleSize = Math.min(
      input.sampleSize || 100,
      Math.max(1, readyTasks.length)
    )
    const shuffled = readyTasks.slice().sort(() => Math.random() - 0.5)
    const sample = shuffled.slice(0, sampleSize)
    const result = await approveBatchMapTranslationTasks(
      prisma,
      sample.map((task) => task.id)
    )

    return {
      ok: true,
      action: input.action,
      done: true,
      message: `抽检发布完成：通过 ${result.approved}，失败 ${result.failed}，跳过 ${result.skipped}`,
      bangumiBackfillCursor: null,
      pointBackfillCursor: null,
      continuation: null,
      snapshot: {
        processed: result.total,
        success: result.approved,
        failed: result.failed,
        reclaimed: 0,
        skipped: result.skipped,
        currentStep: 2,
        totalSteps: 2,
        detail: `抽检发布完成：通过 ${result.approved}，失败 ${result.failed}，跳过 ${result.skipped}`,
        errors: collectErrorMessages(result.results),
        oneKey: null,
      },
    }
  }

  const maxRounds = Math.max(1, Math.min(20, Math.floor(input.maxRounds || 10)))
  const continuation = emptyContinuation(input.continuation || {})
  const startedAt = Date.now()
  let done = false
  let lastDetail = '一键推进进行中'
  let roundProcessed = 0

  for (let cycle = 1; cycle <= maxRounds; cycle += 1) {
    const queueBefore = await loadMapQueueSnapshot(prisma, input.targetLanguage)
    if (
      queueBefore.bangumiPendingLike === 0 &&
      queueBefore.pointPendingLike === 0 &&
      queueBefore.bangumiRemaining === 0 &&
      queueBefore.pointRemaining === 0
    ) {
      done = true
      lastDetail = '地图队列已全部处理完成'
      break
    }

    const lowWaterBackfill = await backfillOneKeyLowWater(
      prisma,
      continuation,
      queueBefore
    )
    if (lowWaterBackfill.triggered && lowWaterBackfill.detail) {
      roundProcessed = lowWaterBackfill.scanned
      lastDetail = lowWaterBackfill.detail
    }

    const failedRound = await executeMapRound(prisma, {
      targetLanguage: input.targetLanguage,
      statusScope: 'failed',
      limitPerType: 10,
      concurrency: 1,
    })
    if (failedRound.processed > 0) {
      continuation.processed += failedRound.processed
      continuation.success += failedRound.success
      continuation.failed += Math.max(0, failedRound.failed - failedRound.reclaimedProcessing)
      continuation.reclaimed += failedRound.reclaimedProcessing
      continuation.skipped += failedRound.skipped
      continuation.errors = appendUniqueMessages(
        continuation.errors,
        failedRound.errorMessages
      )
      roundProcessed = failedRound.processed + lowWaterBackfill.scanned
      lastDetail = lowWaterBackfill.detail
        ? `失败任务优先推进：处理 ${failedRound.processed}，成功 ${failedRound.success}，失败 ${Math.max(0, failedRound.failed - failedRound.reclaimedProcessing)}；${lowWaterBackfill.detail}`
        : `失败任务优先推进：处理 ${failedRound.processed}，成功 ${failedRound.success}，失败 ${Math.max(0, failedRound.failed - failedRound.reclaimedProcessing)}`
    } else {
      const pendingRound = await executeMapRound(prisma, {
        targetLanguage: input.targetLanguage,
        statusScope: 'pending',
        limitPerType: 20,
        concurrency: 2,
      })
      if (pendingRound.processed > 0) {
        continuation.processed += pendingRound.processed
        continuation.success += pendingRound.success
        continuation.failed += Math.max(0, pendingRound.failed - pendingRound.reclaimedProcessing)
        continuation.reclaimed += pendingRound.reclaimedProcessing
        continuation.skipped += pendingRound.skipped
        continuation.errors = appendUniqueMessages(
          continuation.errors,
          pendingRound.errorMessages
        )
        roundProcessed = pendingRound.processed + lowWaterBackfill.scanned
        lastDetail = lowWaterBackfill.detail
          ? `Pending 推进：处理 ${pendingRound.processed}，成功 ${pendingRound.success}，失败 ${Math.max(0, pendingRound.failed - pendingRound.reclaimedProcessing)}；${lowWaterBackfill.detail}`
          : `Pending 推进：处理 ${pendingRound.processed}，成功 ${pendingRound.success}，失败 ${Math.max(0, pendingRound.failed - pendingRound.reclaimedProcessing)}`
      } else {
        const forcedBackfill = lowWaterBackfill.triggered
          ? lowWaterBackfill
          : await backfillOneKeyLowWater(prisma, continuation, queueBefore, {
              force: true,
            })
        if (forcedBackfill.triggered && forcedBackfill.detail) {
          roundProcessed = forcedBackfill.scanned
          lastDetail = forcedBackfill.detail
        }

        if (
          !forcedBackfill.triggered ||
          (forcedBackfill.enqueued === 0 && forcedBackfill.updated === 0)
        ) {
          const queueAfterIdle = await loadMapQueueSnapshot(prisma, input.targetLanguage)
          if (
            queueAfterIdle.bangumiPendingLike === 0 &&
            queueAfterIdle.pointPendingLike === 0 &&
            queueAfterIdle.bangumiRemaining === 0 &&
            queueAfterIdle.pointRemaining === 0
          ) {
            done = true
            lastDetail = '地图队列已全部处理完成'
          }
          break
        }
      }
    }

    if (Date.now() - startedAt >= 10_000) {
      break
    }
  }

  const queue = await loadMapQueueSnapshot(prisma, input.targetLanguage)
  if (
    queue.bangumiPendingLike === 0 &&
    queue.pointPendingLike === 0 &&
    queue.bangumiRemaining === 0 &&
    queue.pointRemaining === 0
  ) {
    done = true
    lastDetail = '地图队列已全部处理完成'
  }

  return {
    ok: true,
    action: input.action,
    done,
    message: lastDetail,
    bangumiBackfillCursor: continuation.bangumiBackfillCursor,
    pointBackfillCursor: continuation.pointBackfillCursor,
    continuation,
    snapshot: buildOneKeySnapshot(
      continuation,
      queue,
      input.targetLanguage,
      roundProcessed,
      lastDetail,
      continuation.processed,
      Math.max(continuation.processed, queue.estimatedUnfinishedTasks || 1)
    ),
  }
}
