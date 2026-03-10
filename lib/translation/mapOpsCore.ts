import type { PrismaClient } from '@prisma/client'
import { getTranslationTaskStatsForAdmin } from '@/lib/translation/adminDashboard'
import { approveBatchMapTranslationTasks } from '@/lib/translation/adminApproval'
import { executeTranslationTasks } from '@/lib/translation/adminExecution'
import {
  getTranslationMapSummary,
  type MapSummaryTargetLanguage,
} from '@/lib/translation/adminMapSummary'
import { enqueueMapTranslationTasksForBackfill } from '@/lib/translation/mapTaskEnqueue'
import {
  appendUniqueMessages,
  collectErrorMessages,
  emptyContinuation,
  type ExecuteStatusScope,
  type MapExecutionSummary,
  type MapOpsContinuation,
  type MapOpsResult,
  type MapQueueSnapshot,
  type RunMapOpsInput,
} from '@/lib/translation/mapOpsShared'
import {
  buildStagnationMessage,
  hasMeaningfulProgress,
} from '@/lib/translation/mapOpsProgress'
import { isRetryableProviderRound } from '@/lib/translation/retryableProviderError'
import { getMapOneKeyPolicy } from '@/lib/translation/runtimeProfile'

const ONE_KEY_LOW_WATER_PENDING_LIKE = {
  anitabi_bangumi: 40,
  anitabi_point: 300,
} as const

const ONE_KEY_BACKFILL_SCAN_LIMIT = {
  anitabi_bangumi: 60,
  anitabi_point: 200,
} as const

const ONE_KEY_BACKFILL_MAX_PAGES_PER_ROUND = {
  anitabi_bangumi: 1,
  anitabi_point: 1,
} as const

const ONE_KEY_MAX_STAGNATION_ROUNDS = 3
const ONE_KEY_MAX_RETRYABLE_STAGNATION_ROUNDS = 10

type MapReadyTask = { id: string; entityType: string }

type OneKeyBackfillSummary = {
  triggered: boolean
  scanned: number
  enqueued: number
  updated: number
  cursorAdvanced: boolean
  detail: string | null
}

type ReadyApprovalSummary = {
  total: number
  approved: number
  failed: number
  skipped: number
  errorMessages: string[]
  detail: string | null
}

function resolveBackfillTargetLanguages(
  targetLanguage: MapSummaryTargetLanguage
): Array<'zh' | 'en' | 'ja'> {
  if (targetLanguage === 'zh') return ['zh']
  if (targetLanguage === 'en') return ['en']
  if (targetLanguage === 'ja') return ['ja']
  return ['zh', 'en', 'ja']
}

function sumQueueOpen(stats: Record<string, unknown>) {
  return (
    Number(stats.pending || 0) +
    Number(stats.processing || 0) +
    Number(stats.ready || 0) +
    Number(stats.failed || 0)
  )
}

function sumPendingLike(stats: Record<string, unknown>) {
  return (
    Number(stats.pending || 0) +
    Number(stats.processing || 0) +
    Number(stats.failed || 0)
  )
}

async function loadStats(
  entityType: 'anitabi_bangumi' | 'anitabi_point',
  targetLanguage: MapSummaryTargetLanguage
) {
  return getTranslationTaskStatsForAdmin({
    entityType,
    targetLanguage,
  })
}

export async function loadMapQueueSnapshot(
  prisma: PrismaClient,
  targetLanguage: MapSummaryTargetLanguage
): Promise<MapQueueSnapshot> {
  const [bangumiStats, pointStats, summary] = await Promise.all([
    loadStats('anitabi_bangumi', targetLanguage),
    loadStats('anitabi_point', targetLanguage),
    getTranslationMapSummary(prisma, targetLanguage),
  ])

  const bangumiQueueOpen = sumQueueOpen(bangumiStats)
  const pointQueueOpen = sumQueueOpen(pointStats)
  const bangumiPendingLike = sumPendingLike(bangumiStats)
  const pointPendingLike = sumPendingLike(pointStats)
  const bangumiReady = Number(bangumiStats.ready || 0)
  const pointReady = Number(pointStats.ready || 0)

  return {
    bangumiRemaining: summary.bangumiRemaining,
    pointRemaining: summary.pointRemaining,
    bangumiQueueOpen,
    pointQueueOpen,
    bangumiPendingLike,
    pointPendingLike,
    bangumiReady,
    pointReady,
    estimatedUnfinishedTasks:
      bangumiQueueOpen +
      pointQueueOpen +
      Number(summary.bangumiRemaining || 0) +
      Number(summary.pointRemaining || 0),
  }
}

export async function executeMapRound(
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

export async function loadReadyTasks(
  prisma: PrismaClient,
  input: {
    limit: number
    targetLanguage: MapSummaryTargetLanguage
    mapOnly?: boolean
  }
): Promise<MapReadyTask[]> {
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

export function isMapQueueFullyDone(queue: MapQueueSnapshot) {
  return (
    Number(queue.bangumiPendingLike || 0) === 0 &&
    Number(queue.pointPendingLike || 0) === 0 &&
    Number(queue.bangumiReady || 0) === 0 &&
    Number(queue.pointReady || 0) === 0 &&
    Number(queue.bangumiRemaining || 0) === 0 &&
    Number(queue.pointRemaining || 0) === 0
  )
}

function rememberBaseline(
  continuation: MapOpsContinuation,
  queue: MapQueueSnapshot
) {
  continuation.baselineEstimatedTotal = Math.max(
    Number(continuation.baselineEstimatedTotal || 0),
    Number(queue.estimatedUnfinishedTasks || 0)
  )
}

function translateFailures(result: MapExecutionSummary) {
  return Math.max(0, result.failed - result.reclaimedProcessing)
}

function applyExecutionSummary(
  continuation: MapOpsContinuation,
  result: MapExecutionSummary
) {
  continuation.processed += result.processed
  continuation.success += result.success
  continuation.failed += translateFailures(result)
  continuation.reclaimed += result.reclaimedProcessing
  continuation.skipped += result.skipped
  continuation.errors = appendUniqueMessages(
    continuation.errors,
    result.errorMessages
  )
}

function applyApprovalSummary(
  continuation: MapOpsContinuation,
  result: ReadyApprovalSummary
) {
  continuation.processed += result.approved + result.failed
  continuation.success += result.approved
  continuation.failed += result.failed
  continuation.skipped += result.skipped
  continuation.approved += result.approved
  continuation.approvalFailed += result.failed
  continuation.errors = appendUniqueMessages(
    continuation.errors,
    result.errorMessages
  )
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

function shouldRunLowWaterBackfill(queue: MapQueueSnapshot) {
  return shouldBackfillEntity(queue, 'anitabi_bangumi') || shouldBackfillEntity(queue, 'anitabi_point')
}

async function backfillOneKeyLowWater(
  prisma: PrismaClient,
  continuation: MapOpsContinuation,
  queue: MapQueueSnapshot,
  targetLanguage: MapSummaryTargetLanguage,
  options: { force?: boolean } = {}
): Promise<OneKeyBackfillSummary> {
  const force = options.force === true
  const targetLanguages = resolveBackfillTargetLanguages(targetLanguage)
  const detailParts: string[] = []
  let scanned = 0
  let enqueued = 0
  let updated = 0
  let cursorAdvanced = false

  if (shouldBackfillEntity(queue, 'anitabi_bangumi', force)) {
    let entityScanned = 0
    let entityEnqueued = 0
    let entityUpdated = 0
    let entityCursorAdvanced = false

    for (
      let page = 0;
      page < ONE_KEY_BACKFILL_MAX_PAGES_PER_ROUND.anitabi_bangumi;
      page += 1
    ) {
      const cursorBefore = continuation.bangumiBackfillCursor
      const result = await enqueueMapTranslationTasksForBackfill({
        prisma,
        entityType: 'anitabi_bangumi',
        targetLanguages,
        mode: 'missing',
        limit: ONE_KEY_BACKFILL_SCAN_LIMIT.anitabi_bangumi,
        cursor: cursorBefore,
      })
      continuation.bangumiBackfillCursor = result.done ? null : result.nextCursor
      continuation.bangumiBackfilledTotal += result.enqueued + result.updated
      continuation.bangumiBatch += 1
      continuation.success += result.enqueued
      continuation.skipped += result.updated
      entityScanned += result.scanned
      entityEnqueued += result.enqueued
      entityUpdated += result.updated
      if (
        !result.done &&
        result.nextCursor &&
        result.nextCursor !== cursorBefore
      ) {
        entityCursorAdvanced = true
      }
      if (result.enqueued > 0 || result.updated > 0 || result.done) {
        break
      }
    }

    scanned += entityScanned
    enqueued += entityEnqueued
    updated += entityUpdated
    cursorAdvanced ||= entityCursorAdvanced

    if (entityScanned > 0 || entityEnqueued > 0 || entityUpdated > 0) {
      detailParts.push(
        entityEnqueued > 0 || entityUpdated > 0
          ? `作品 扫描 ${entityScanned}，新建 ${entityEnqueued}/更新 ${entityUpdated}`
          : entityCursorAdvanced
            ? `作品 扫描 ${entityScanned}，暂未命中缺口，继续向后扫描`
            : `作品 扫描 ${entityScanned}，本轮未命中缺口`
      )
    }
  }

  if (shouldBackfillEntity(queue, 'anitabi_point', force)) {
    let entityScanned = 0
    let entityEnqueued = 0
    let entityUpdated = 0
    let entityCursorAdvanced = false

    for (
      let page = 0;
      page < ONE_KEY_BACKFILL_MAX_PAGES_PER_ROUND.anitabi_point;
      page += 1
    ) {
      const cursorBefore = continuation.pointBackfillCursor
      const result = await enqueueMapTranslationTasksForBackfill({
        prisma,
        entityType: 'anitabi_point',
        targetLanguages,
        mode: 'missing',
        limit: ONE_KEY_BACKFILL_SCAN_LIMIT.anitabi_point,
        cursor: cursorBefore,
      })
      continuation.pointBackfillCursor = result.done ? null : result.nextCursor
      continuation.pointBackfilledEnqueued += result.enqueued
      continuation.pointBackfilledUpdated += result.updated
      continuation.success += result.enqueued
      continuation.skipped += result.updated
      entityScanned += result.scanned
      entityEnqueued += result.enqueued
      entityUpdated += result.updated
      if (
        !result.done &&
        result.nextCursor &&
        result.nextCursor !== cursorBefore
      ) {
        entityCursorAdvanced = true
      }
      if (result.enqueued > 0 || result.updated > 0 || result.done) {
        break
      }
    }

    scanned += entityScanned
    enqueued += entityEnqueued
    updated += entityUpdated
    cursorAdvanced ||= entityCursorAdvanced

    if (entityScanned > 0 || entityEnqueued > 0 || entityUpdated > 0) {
      detailParts.push(
        entityEnqueued > 0 || entityUpdated > 0
          ? `点位 扫描 ${entityScanned}，新建 ${entityEnqueued}/更新 ${entityUpdated}`
          : entityCursorAdvanced
            ? `点位 扫描 ${entityScanned}，暂未命中缺口，继续向后扫描`
            : `点位 扫描 ${entityScanned}，本轮未命中缺口`
      )
    }
  }

  return {
    triggered: detailParts.length > 0,
    scanned,
    enqueued,
    updated,
    cursorAdvanced,
    detail:
      detailParts.length > 0
        ? `${force ? '补队完成' : '低水位自动补队'}：${detailParts.join('，')}`
        : null,
  }
}

async function approveReadyMapRound(
  prisma: PrismaClient,
  targetLanguage: MapSummaryTargetLanguage
): Promise<ReadyApprovalSummary> {
  const oneKeyPolicy = getMapOneKeyPolicy()
  const readyTasks = await loadReadyTasks(prisma, {
    limit: oneKeyPolicy.approveLimit,
    targetLanguage,
    mapOnly: true,
  })

  if (readyTasks.length === 0) {
    return {
      total: 0,
      approved: 0,
      failed: 0,
      skipped: 0,
      errorMessages: [],
      detail: null,
    }
  }

  const result = await approveBatchMapTranslationTasks(
    prisma,
    readyTasks.map((task) => task.id)
  )

  return {
    total: result.total,
    approved: result.approved,
    failed: result.failed,
    skipped: result.skipped,
    errorMessages: collectErrorMessages(result.results),
    detail: `自动审核：通过 ${result.approved}，失败 ${result.failed}，跳过 ${result.skipped}`,
  }
}

function calcCompletionPercent(
  continuation: MapOpsContinuation,
  queue: MapQueueSnapshot
) {
  const baseline = Math.max(
    Number(continuation.baselineEstimatedTotal || 0),
    Number(queue.estimatedUnfinishedTasks || 0)
  )
  if (baseline <= 0) return 100
  const unfinished = Math.max(0, Number(queue.estimatedUnfinishedTasks || 0))
  const completed = Math.max(0, baseline - unfinished)
  return Math.max(0, Math.min(100, Math.round((completed / baseline) * 100)))
}

function buildOneKeySnapshot(input: {
  continuation: MapOpsContinuation
  queue: MapQueueSnapshot
  roundProcessed: number
  detail: string
}) {
  const baseline = Math.max(
    Number(input.continuation.baselineEstimatedTotal || 0),
    Number(input.queue.estimatedUnfinishedTasks || 0),
    1
  )
  const unfinished = Math.max(0, Number(input.queue.estimatedUnfinishedTasks || 0))
  const completed = Math.max(0, baseline - unfinished)
  const pointUnqueuedEstimate =
    input.queue.pointRemaining === null
      ? null
      : Math.max(0, Number(input.queue.pointRemaining || 0))
  const pointUnfinishedTotal =
    input.queue.pointQueueOpen === null || pointUnqueuedEstimate === null
      ? null
      : Number(input.queue.pointQueueOpen || 0) + pointUnqueuedEstimate
  const readyTotal =
    input.queue.bangumiReady === null || input.queue.pointReady === null
      ? null
      : Number(input.queue.bangumiReady || 0) + Number(input.queue.pointReady || 0)

  return {
    processed: input.continuation.processed,
    success: input.continuation.success,
    failed: input.continuation.failed,
    reclaimed: input.continuation.reclaimed,
    skipped: input.continuation.skipped,
    currentStep: completed,
    totalSteps: baseline,
    detail: input.detail,
    errors: input.continuation.errors,
    oneKey: {
      bangumiBatch: input.continuation.bangumiBatch,
      bangumiBackfilledTotal: input.continuation.bangumiBackfilledTotal,
      bangumiRemaining: input.queue.bangumiRemaining,
      readyTotal,
      unfinishedTotal: input.queue.estimatedUnfinishedTasks,
      pointBackfilledEnqueued: input.continuation.pointBackfilledEnqueued,
      pointBackfilledUpdated: input.continuation.pointBackfilledUpdated,
      pointBackfilledTotal:
        input.continuation.pointBackfilledEnqueued +
        input.continuation.pointBackfilledUpdated,
      pointQueueOpen: input.queue.pointQueueOpen,
      pointUnqueuedEstimate,
      pointUnfinishedTotal,
      roundProcessed: input.roundProcessed,
      totalProcessed: input.continuation.processed,
      approvedTotal: input.continuation.approved,
      approvalFailedTotal: input.continuation.approvalFailed,
      stagnationCount: input.continuation.stagnationCount,
      estimatedTotal: baseline,
      completionPercent: calcCompletionPercent(
        input.continuation,
        input.queue
      ),
    },
  }
}

export async function runAdvanceOneKeyMapOps(
  prisma: PrismaClient,
  input: RunMapOpsInput
): Promise<MapOpsResult> {
  const oneKeyPolicy = getMapOneKeyPolicy()
  const nextContinuation: MapOpsContinuation = emptyContinuation(
    input.continuation || {}
  )
  const emptyBackfill: OneKeyBackfillSummary = {
    triggered: false,
    scanned: 0,
    enqueued: 0,
    updated: 0,
    cursorAdvanced: false,
    detail: null,
  }
  const emptyApprovals: ReadyApprovalSummary = {
    total: 0,
    approved: 0,
    failed: 0,
    skipped: 0,
    errorMessages: [],
    detail: null,
  }
  const emptyExecution: MapExecutionSummary = {
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    reclaimedProcessing: 0,
    errorMessages: [],
  }

  let done = false, halted = false
  let lastDetail = '一键推进进行中'
  let roundProcessed = 0
  const queueBefore = await loadMapQueueSnapshot(prisma, input.targetLanguage)
  rememberBaseline(nextContinuation, queueBefore)

  if (isMapQueueFullyDone(queueBefore)) {
    done = true
    lastDetail = '地图翻译与审核已全部完成'
    return {
      ok: true,
      action: input.action,
      done,
      message: lastDetail,
      bangumiBackfillCursor: nextContinuation.bangumiBackfillCursor,
      pointBackfillCursor: nextContinuation.pointBackfillCursor,
      continuation: null,
      snapshot: buildOneKeySnapshot({
        continuation: nextContinuation,
        queue: queueBefore,
        roundProcessed,
        detail: lastDetail,
      }),
    }
  }

  const detailParts: string[] = []
  let backfill = emptyBackfill
  let approvals = emptyApprovals
  let failedRound = emptyExecution
  let pendingRound = emptyExecution

  if (Number(queueBefore.bangumiReady || 0) + Number(queueBefore.pointReady || 0) > 0) {
    approvals = await approveReadyMapRound(prisma, input.targetLanguage)
    if (approvals.total > 0) {
      applyApprovalSummary(nextContinuation, approvals)
      roundProcessed = approvals.total
      if (approvals.detail) detailParts.push(approvals.detail)
    }
  } else if (shouldRunLowWaterBackfill(queueBefore)) {
    backfill = await backfillOneKeyLowWater(
      prisma,
      nextContinuation,
      queueBefore,
      input.targetLanguage
    )
    roundProcessed = backfill.enqueued + backfill.updated
    if (backfill.detail) {
      detailParts.push(backfill.detail)
    }
  } else {
    failedRound = await executeMapRound(prisma, {
      targetLanguage: input.targetLanguage,
      statusScope: 'failed',
      limitPerType: oneKeyPolicy.failedLimitPerType,
      concurrency: oneKeyPolicy.executionConcurrency,
    })

    if (failedRound.total > 0) {
      applyExecutionSummary(nextContinuation, failedRound)
      roundProcessed = failedRound.processed
      detailParts.push(
        `失败重试：处理 ${failedRound.processed}，成功 ${failedRound.success}，失败 ${translateFailures(failedRound)}`
      )
    } else {
      pendingRound = await executeMapRound(prisma, {
        targetLanguage: input.targetLanguage,
        statusScope: 'pending',
        limitPerType: oneKeyPolicy.pendingLimitPerType,
        concurrency: oneKeyPolicy.executionConcurrency,
      })

      if (pendingRound.total > 0) {
        applyExecutionSummary(nextContinuation, pendingRound)
        roundProcessed = pendingRound.processed
        detailParts.push(
          `待翻译推进：处理 ${pendingRound.processed}，成功 ${pendingRound.success}，失败 ${translateFailures(pendingRound)}`
        )
      } else {
        backfill = await backfillOneKeyLowWater(
          prisma,
          nextContinuation,
          queueBefore,
          input.targetLanguage,
          { force: true }
        )
        roundProcessed = backfill.enqueued + backfill.updated
        if (backfill.detail) {
          detailParts.push(backfill.detail)
        }
      }
    }
  }

  const queue = await loadMapQueueSnapshot(prisma, input.targetLanguage)
  rememberBaseline(nextContinuation, queue)

  const progressed = hasMeaningfulProgress({
    queueBefore,
    queueAfter: queue,
    backfill,
    approvals,
    failedRound,
    pendingRound,
  })
  const retryableFailureRound =
    !progressed &&
    (isRetryableProviderRound(failedRound) ||
      isRetryableProviderRound(pendingRound))
  nextContinuation.retryableStagnationCount = progressed
    ? 0
    : retryableFailureRound
      ? nextContinuation.retryableStagnationCount + 1
      : 0
  nextContinuation.stagnationCount = progressed || retryableFailureRound
    ? 0
    : nextContinuation.stagnationCount + 1

  lastDetail =
    detailParts.length > 0
      ? detailParts.join('；')
      : '本轮没有可推进的地图任务'

  if (isMapQueueFullyDone(queue)) {
    done = true
    lastDetail = '地图翻译与审核已全部完成'
  } else if (
    nextContinuation.stagnationCount >= ONE_KEY_MAX_STAGNATION_ROUNDS ||
    nextContinuation.retryableStagnationCount >=
      ONE_KEY_MAX_RETRYABLE_STAGNATION_ROUNDS
  ) {
    halted = true
    lastDetail = buildStagnationMessage(nextContinuation, queue)
  }

  return {
    ok: true,
    action: input.action,
    done,
    message: lastDetail,
    bangumiBackfillCursor: nextContinuation.bangumiBackfillCursor,
    pointBackfillCursor: nextContinuation.pointBackfillCursor,
    continuation: done || halted ? null : nextContinuation,
    snapshot: buildOneKeySnapshot({
      continuation: nextContinuation,
      queue,
      roundProcessed,
      detail: lastDetail,
    }),
  }
}
