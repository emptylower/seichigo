import type { MapTaskEnqueueMode } from '@/lib/translation/mapTaskEnqueue'
import type { MapSummaryTargetLanguage } from '@/lib/translation/adminMapSummary'

export type MapOpsAction =
  | 'backfill_once'
  | 'incremental_refill'
  | 'execute_round'
  | 'manual_advance'
  | 'approve_all_ready'
  | 'approve_sample'
  | 'advance_one_key'

export type MapOpsContinuation = {
  bangumiBackfillCursor: string | null
  pointBackfillCursor: string | null
  processed: number
  success: number
  failed: number
  reclaimed: number
  skipped: number
  errors: string[]
  bangumiBackfilledTotal: number
  pointBackfilledEnqueued: number
  pointBackfilledUpdated: number
  bangumiBatch: number
  approved: number
  approvalFailed: number
  baselineEstimatedTotal: number
  stagnationCount: number
}

export type MapOpsSnapshot = {
  processed: number
  success: number
  failed: number
  reclaimed: number
  skipped: number
  currentStep: number
  totalSteps: number
  detail: string
  errors: string[]
  oneKey: {
    bangumiBatch: number
    bangumiBackfilledTotal: number
    bangumiRemaining: number | null
    readyTotal: number | null
    unfinishedTotal: number | null
    pointBackfilledEnqueued: number
    pointBackfilledUpdated: number
    pointBackfilledTotal: number
    pointQueueOpen: number | null
    pointUnqueuedEstimate: number | null
    pointUnfinishedTotal: number | null
    roundProcessed: number
    totalProcessed: number
    approvedTotal: number
    approvalFailedTotal: number
    stagnationCount: number
    estimatedTotal: number | null
    completionPercent: number
  } | null
}

export type MapOpsResult = {
  ok: true
  action: MapOpsAction
  done: boolean
  message: string
  bangumiBackfillCursor: string | null
  pointBackfillCursor: string | null
  continuation: MapOpsContinuation | null
  snapshot: MapOpsSnapshot
}

export type MapExecutionSummary = {
  total: number
  processed: number
  success: number
  failed: number
  skipped: number
  reclaimedProcessing: number
  errorMessages: string[]
}

export type MapQueueSnapshot = {
  bangumiRemaining: number | null
  pointRemaining: number | null
  bangumiQueueOpen: number | null
  pointQueueOpen: number | null
  bangumiPendingLike: number | null
  pointPendingLike: number | null
  bangumiReady: number | null
  pointReady: number | null
  estimatedUnfinishedTasks: number | null
}

export type ExecuteStatusScope = 'pending' | 'failed' | 'pending_or_failed'

export type RunMapOpsInput = {
  action: MapOpsAction
  targetLanguage: MapSummaryTargetLanguage
  entityType?: 'anitabi_bangumi' | 'anitabi_point'
  mode?: MapTaskEnqueueMode
  statusScope?: ExecuteStatusScope
  limitPerType?: number
  concurrency?: number
  maxRounds?: number
  sampleSize?: number
  q?: string | null
  continuation?: Partial<MapOpsContinuation> | null
}

export function appendUniqueMessages(
  target: string[],
  incoming: string[],
  max = 8
): string[] {
  const next = [...target]
  const seen = new Set(next)
  for (const message of incoming) {
    const text = String(message || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    next.push(text)
    if (next.length >= max) break
  }
  return next
}

export function collectErrorMessages(results: unknown): string[] {
  if (!Array.isArray(results)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of results) {
    const error = String((row as { error?: unknown } | null)?.error || '').trim()
    if (!error || seen.has(error)) continue
    seen.add(error)
    out.push(error)
    if (out.length >= 6) break
  }
  return out
}

export function calcCompletionPercent(
  processed: number,
  estimatedTotal: number | null
) {
  if (estimatedTotal === null) return 0
  if (estimatedTotal <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((processed / estimatedTotal) * 100)))
}

export function emptyContinuation(
  input: Partial<MapOpsContinuation> = {}
): MapOpsContinuation {
  return {
    bangumiBackfillCursor: input.bangumiBackfillCursor || null,
    pointBackfillCursor: input.pointBackfillCursor || null,
    processed: input.processed || 0,
    success: input.success || 0,
    failed: input.failed || 0,
    reclaimed: input.reclaimed || 0,
    skipped: input.skipped || 0,
    errors: input.errors || [],
    bangumiBackfilledTotal: input.bangumiBackfilledTotal || 0,
    pointBackfilledEnqueued: input.pointBackfilledEnqueued || 0,
    pointBackfilledUpdated: input.pointBackfilledUpdated || 0,
    bangumiBatch: input.bangumiBatch || 0,
    approved: input.approved || 0,
    approvalFailed: input.approvalFailed || 0,
    baselineEstimatedTotal: input.baselineEstimatedTotal || 0,
    stagnationCount: input.stagnationCount || 0,
  }
}
