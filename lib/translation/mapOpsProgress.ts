import type {
  MapExecutionSummary,
  MapOpsContinuation,
  MapQueueSnapshot,
} from '@/lib/translation/mapOpsShared'

export function hasMeaningfulProgress(input: {
  queueBefore: MapQueueSnapshot
  queueAfter: MapQueueSnapshot
  backfill: { enqueued: number; updated: number; cursorAdvanced: boolean }
  approvals: { approved: number }
  failedRound: MapExecutionSummary
  pendingRound: MapExecutionSummary
}) {
  if (
    Number(input.queueAfter.estimatedUnfinishedTasks || 0) <
    Number(input.queueBefore.estimatedUnfinishedTasks || 0)
  ) {
    return true
  }

  return (
    input.backfill.enqueued > 0 ||
    input.backfill.updated > 0 ||
    input.backfill.cursorAdvanced ||
    input.approvals.approved > 0 ||
    input.failedRound.success > 0 ||
    input.failedRound.reclaimedProcessing > 0 ||
    input.pendingRound.success > 0 ||
    input.pendingRound.reclaimedProcessing > 0
  )
}

export function buildStagnationMessage(
  continuation: MapOpsContinuation,
  queue: MapQueueSnapshot
) {
  const stalledRounds = Math.max(
    continuation.stagnationCount,
    continuation.retryableStagnationCount
  )
  const reason =
    continuation.retryableStagnationCount > 0
      ? '上游可恢复错误连续重试未恢复'
      : '无有效进展'

  return `自动推进暂停：连续 ${stalledRounds} 轮${reason}。待审核 ${Number(queue.bangumiReady || 0) + Number(queue.pointReady || 0)}，待执行/失败 ${Number(queue.bangumiPendingLike || 0) + Number(queue.pointPendingLike || 0)}，未入队 ${Number(queue.bangumiRemaining || 0) + Number(queue.pointRemaining || 0)}`
}
