import type { TranslationTaskListItem } from '@/lib/translation/adminDashboard'
import {
  MAP_EXECUTE_RETRY_DELAY_MS,
  MAP_ONE_KEY_BACKFILL_LIMIT,
  MAP_ONE_KEY_BACKFILL_MAX_SWEEPS,
  MAP_ONE_KEY_MAX_CONSECUTIVE_FAILED_ONLY,
  MAP_ONE_KEY_MAX_CONSECUTIVE_FAILURES,
  MAP_ONE_KEY_MAX_ROUNDS,
  MAP_ONE_KEY_RETRY_PER_ROUND,
  appendUniqueMessages,
  calcCompletionPercent,
  collectErrorMessages,
  formatMetricCount,
  isRetryableExecuteMessage,
  normalizeFetchErrorMessage,
  sleep,
  type MapExecuteStatusScope,
  type MapExecutionSummary,
  type MapOpsProgress,
  type OneKeyMapMetrics,
  type OneKeyMapQueueSnapshot,
} from './helpers'

type BackfillResult = {
  scanned: number
  enqueued: number
  updated: number
  nextCursor: string | null
  done: boolean
}

type OneKeyAdvanceDeps = {
  targetLanguage: string
  bangumiBackfillCursor: string | null
  pointBackfillCursor: string | null
  setBangumiBackfillCursor: (cursor: string | null) => void
  setPointBackfillCursor: (cursor: string | null) => void
  setMapOpsLoading: (loading: boolean) => void
  setMapOpsMessage: (message: string | null) => void
  beginMapOpsProgress: (input: { title: string; totalSteps: number; detail: string }) => void
  patchMapOpsProgress: (patch: Partial<MapOpsProgress>) => void
  loadOneKeyMapQueueSnapshot: (targetLanguage: string) => Promise<OneKeyMapQueueSnapshot>
  runMapBackfillOnce: (input: {
    entityType: 'anitabi_bangumi' | 'anitabi_point'
    mode: 'missing' | 'stale' | 'all'
    limit?: number
    cursor?: string | null
  }) => Promise<BackfillResult>
  executeMapTranslateRound: (input?: {
    statusScope?: MapExecuteStatusScope
    limitPerType?: number
    concurrency?: number
  }) => Promise<MapExecutionSummary>
  loadReadyMapTasks: (limitPerType: number) => Promise<TranslationTaskListItem[]>
  reload: () => Promise<void>
  toast: {
    success: (...args: any[]) => void
    info: (...args: any[]) => void
    error: (...args: any[]) => void
  }
}

export async function handleOneKeyAdvanceMapQueue(deps: OneKeyAdvanceDeps): Promise<void> {
  const {
    targetLanguage,
    bangumiBackfillCursor,
    pointBackfillCursor,
    setBangumiBackfillCursor,
    setPointBackfillCursor,
    setMapOpsLoading,
    setMapOpsMessage,
    beginMapOpsProgress,
    patchMapOpsProgress,
    loadOneKeyMapQueueSnapshot,
    runMapBackfillOnce,
    executeMapTranslateRound,
    loadReadyMapTasks,
    reload,
    toast,
  } = deps

  setMapOpsLoading(true)
  setMapOpsMessage(null)
  try {
    let attemptedRounds = 0
    let progressedRounds = 0
    let totalProcessed = 0
    let totalSuccess = 0
    let totalFailed = 0
    let totalReclaimed = 0
    let totalSkipped = 0
    let totalBackfillEnqueued = 0
    let totalBackfillUpdated = 0
    let consecutiveNoProgress = 0
    let consecutiveFailedOnly = 0
    let allErrors: string[] = []
    let completionState: 'done' | 'stopped' | 'capped' = 'capped'
    let stoppedByFailedOnly = false
    let bangumiCursor = bangumiBackfillCursor
    let pointCursor = pointBackfillCursor
    let bangumiBatch = 0
    let totalBangumiBackfilled = 0
    let totalPointBackfilledEnqueued = 0
    let totalPointBackfilledUpdated = 0
    const langMultiplier = targetLanguage === 'all' ? 2 : 1
    let queueSnapshot = await loadOneKeyMapQueueSnapshot(targetLanguage)
    const initialPendingLikeTotal =
      queueSnapshot.bangumiPendingLike === null || queueSnapshot.pointPendingLike === null
        ? null
        : queueSnapshot.bangumiPendingLike + queueSnapshot.pointPendingLike
    let estimatedTotal: number | null =
      queueSnapshot.estimatedUnfinishedTasks !== null
        ? Math.max(0, Number(queueSnapshot.estimatedUnfinishedTasks || 0))
        : initialPendingLikeTotal

    const refreshQueueSnapshot = async () => {
      const nextSnapshot = await loadOneKeyMapQueueSnapshot(targetLanguage)
      queueSnapshot = {
        bangumiRemaining: nextSnapshot.bangumiRemaining ?? queueSnapshot.bangumiRemaining,
        pointRemaining: nextSnapshot.pointRemaining ?? queueSnapshot.pointRemaining,
        bangumiQueueOpen: nextSnapshot.bangumiQueueOpen ?? queueSnapshot.bangumiQueueOpen,
        pointQueueOpen: nextSnapshot.pointQueueOpen ?? queueSnapshot.pointQueueOpen,
        bangumiPendingLike: nextSnapshot.bangumiPendingLike ?? queueSnapshot.bangumiPendingLike,
        pointPendingLike: nextSnapshot.pointPendingLike ?? queueSnapshot.pointPendingLike,
        estimatedUnfinishedTasks: nextSnapshot.estimatedUnfinishedTasks ?? queueSnapshot.estimatedUnfinishedTasks,
      }
      if (queueSnapshot.estimatedUnfinishedTasks !== null) {
        const candidate = totalProcessed + Number(queueSnapshot.estimatedUnfinishedTasks || 0)
        estimatedTotal = estimatedTotal === null ? candidate : Math.max(estimatedTotal, candidate)
        return
      }

      if (queueSnapshot.bangumiPendingLike !== null && queueSnapshot.pointPendingLike !== null) {
        const candidate = totalProcessed + queueSnapshot.bangumiPendingLike + queueSnapshot.pointPendingLike
        estimatedTotal = estimatedTotal === null ? candidate : Math.max(estimatedTotal, candidate)
      }
    }

    const hasNoMissingEntities = () =>
      queueSnapshot.bangumiRemaining !== null &&
      queueSnapshot.pointRemaining !== null &&
      queueSnapshot.bangumiRemaining === 0 &&
      queueSnapshot.pointRemaining === 0

    const hasNoPendingLikeQueue = () =>
      queueSnapshot.bangumiPendingLike !== null &&
      queueSnapshot.pointPendingLike !== null &&
      queueSnapshot.bangumiPendingLike === 0 &&
      queueSnapshot.pointPendingLike === 0

    const buildOneKeyMetrics = (roundProcessed: number): OneKeyMapMetrics => {
      const pointUnqueuedEstimate =
        queueSnapshot.pointRemaining === null ? null : Math.max(0, queueSnapshot.pointRemaining * langMultiplier)
      const pointUnfinishedTotal =
        queueSnapshot.pointQueueOpen === null || pointUnqueuedEstimate === null
          ? null
          : queueSnapshot.pointQueueOpen + pointUnqueuedEstimate
      return {
        bangumiBatch,
        bangumiBackfilledTotal: totalBangumiBackfilled,
        bangumiRemaining: queueSnapshot.bangumiRemaining,
        pointBackfilledEnqueued: totalPointBackfilledEnqueued,
        pointBackfilledUpdated: totalPointBackfilledUpdated,
        pointBackfilledTotal: totalPointBackfilledEnqueued + totalPointBackfilledUpdated,
        pointQueueOpen: queueSnapshot.pointQueueOpen,
        pointUnqueuedEstimate,
        pointUnfinishedTotal,
        roundProcessed,
        totalProcessed,
        estimatedTotal,
        completionPercent: calcCompletionPercent(totalProcessed, estimatedTotal),
      }
    }

    const patchOneKeyProgress = (input: {
      currentStep: number
      totalSteps: number
      detail: string
      roundProcessed: number
    }) => {
      patchMapOpsProgress({
        currentStep: input.currentStep,
        totalSteps: input.totalSteps,
        processed: totalProcessed,
        success: totalSuccess,
        failed: totalFailed,
        reclaimed: totalReclaimed,
        skipped: totalSkipped,
        errors: allErrors,
        detail: input.detail,
        oneKey: buildOneKeyMetrics(input.roundProcessed),
      })
    }

    beginMapOpsProgress({
      title: '一键推进地图队列',
      totalSteps: 2,
      detail: '准备开始：优先处理失败任务...',
    })
    patchMapOpsProgress({ oneKey: buildOneKeyMetrics(0) })

    const mergeRound = (round: MapExecutionSummary) => {
      const translationFailed = Math.max(0, round.failed - round.reclaimedProcessing)
      totalProcessed += round.processed
      totalSuccess += round.success
      totalFailed += translationFailed
      totalReclaimed += round.reclaimedProcessing
      totalSkipped += round.skipped
      allErrors = appendUniqueMessages(allErrors, round.errorMessages)
      return translationFailed
    }

    const detectFailedOnlyStall = (input: { roundSuccess: number; translationFailed: number }): boolean => {
      if (input.roundSuccess > 0 || input.translationFailed <= 0) {
        consecutiveFailedOnly = 0
        return false
      }

      consecutiveFailedOnly += 1
      if (consecutiveFailedOnly < MAP_ONE_KEY_MAX_CONSECUTIVE_FAILED_ONLY) return false

      stoppedByFailedOnly = true
      completionState = 'stopped'
      allErrors = appendUniqueMessages(allErrors, [
        `连续 ${consecutiveFailedOnly} 轮仅产生失败、无成功转化，已停止自动重试并转入抽样发布`,
      ])
      return true
    }

    const backfillUntilProgress = async (input: {
      entityType: 'anitabi_bangumi' | 'anitabi_point'
      cursor: string | null
    }): Promise<{ scanned: number; enqueued: number; updated: number; nextCursor: string | null; done: boolean; sweeps: number }> => {
      let nextCursor = input.cursor
      let scanned = 0
      let enqueued = 0
      let updated = 0
      let done = false
      let sweeps = 0

      for (let i = 0; i < MAP_ONE_KEY_BACKFILL_MAX_SWEEPS; i += 1) {
        const row = await runMapBackfillOnce({
          entityType: input.entityType,
          mode: 'missing',
          limit: MAP_ONE_KEY_BACKFILL_LIMIT,
          cursor: nextCursor,
        })
        sweeps += 1
        scanned += row.scanned
        enqueued += row.enqueued
        updated += row.updated
        nextCursor = row.done ? null : row.nextCursor
        done = row.done

        if (row.enqueued > 0 || row.updated > 0 || row.done) {
          break
        }
      }

      return { scanned, enqueued, updated, nextCursor, done, sweeps }
    }

    const executeRoundWithRetries = async (statusScope: MapExecuteStatusScope, cycle: number, stageLabel: string) => {
      let aggregatedErrors: string[] = []
      let lastRound: MapExecutionSummary | null = null

      for (let retry = 0; retry <= MAP_ONE_KEY_RETRY_PER_ROUND; retry += 1) {
        const round = await executeMapTranslateRound({ statusScope })
        aggregatedErrors = appendUniqueMessages(aggregatedErrors, round.errorMessages, 10)
        lastRound = {
          ...round,
          errorMessages: aggregatedErrors,
        }

        const hasRetryableError = aggregatedErrors.some(
          (message) => isRetryableExecuteMessage(message) || message.includes('未拿到有效执行结果')
        )
        const shouldRetry =
          round.processed === 0 &&
          round.total > 0 &&
          hasRetryableError &&
          retry < MAP_ONE_KEY_RETRY_PER_ROUND

        if (!shouldRetry) break

        allErrors = appendUniqueMessages(allErrors, aggregatedErrors)
        patchOneKeyProgress({
          currentStep: cycle - 1,
          totalSteps: Math.max(2, cycle + 1),
          roundProcessed: 0,
          detail: `第 ${cycle} 轮${stageLabel}未推进，自动重试 ${retry + 1}/${MAP_ONE_KEY_RETRY_PER_ROUND}...`,
        })
        await sleep(MAP_EXECUTE_RETRY_DELAY_MS)
      }

      return (
        lastRound || {
          total: 0,
          processed: 0,
          success: 0,
          failed: 0,
          skipped: 0,
          reclaimedProcessing: 0,
          errorMessages: aggregatedErrors,
        }
      )
    }

    for (let cycle = 1; cycle <= MAP_ONE_KEY_MAX_ROUNDS; cycle += 1) {
      attemptedRounds = cycle
      let backfillScannedThisRound = 0
      let backfillEnqueuedThisRound = 0
      let backfillUpdatedThisRound = 0
      let backfillCursorAdvancedThisRound = false
      let backfillReachedEndThisRound = false
      patchOneKeyProgress({
        currentStep: cycle - 1,
        totalSteps: Math.max(2, cycle + 1),
        roundProcessed: 0,
        detail: `第 ${cycle} 轮：优先重试失败任务...`,
      })

      const failedRound = await executeRoundWithRetries('failed', cycle, '（失败优先）')
      const failedTranslationFailed = mergeRound(failedRound)
      if (failedRound.processed > 0) {
        progressedRounds += 1
        consecutiveNoProgress = 0
        await refreshQueueSnapshot()
        patchOneKeyProgress({
          currentStep: cycle,
          totalSteps: Math.max(2, cycle + 1),
          roundProcessed: failedRound.processed,
          detail: `第 ${cycle} 轮：失败任务优先推进完成（处理 ${failedRound.processed}，成功 ${failedRound.success}，翻译失败 ${failedTranslationFailed}，回收 ${failedRound.reclaimedProcessing}）`,
        })
        if (detectFailedOnlyStall({ roundSuccess: failedRound.success, translationFailed: failedTranslationFailed })) {
          patchOneKeyProgress({
            currentStep: cycle,
            totalSteps: Math.max(2, cycle + 1),
            roundProcessed: failedRound.processed,
            detail: `第 ${cycle} 轮：失败任务连续仅失败，停止重试并转入抽样发布...`,
          })
          break
        }
        continue
      }

      if (failedRound.total > 0) {
        consecutiveNoProgress += 1
        await refreshQueueSnapshot()
        patchOneKeyProgress({
          currentStep: cycle,
          totalSteps: Math.max(2, cycle + 1),
          roundProcessed: 0,
          detail: `第 ${cycle} 轮：失败任务仍存在但无进展（连续 ${consecutiveNoProgress} 轮）`,
        })
        if (consecutiveNoProgress >= MAP_ONE_KEY_MAX_CONSECUTIVE_FAILURES) {
          completionState = 'stopped'
          break
        }
        continue
      }

      await refreshQueueSnapshot()
      if (hasNoMissingEntities() && hasNoPendingLikeQueue()) {
        completionState = 'done'
        patchOneKeyProgress({
          currentStep: cycle,
          totalSteps: Math.max(2, cycle + 1),
          roundProcessed: 0,
          detail: `第 ${cycle} 轮：当前无缺失项且待处理队列为空，准备进入抽样发布...`,
        })
        break
      }

      let bangumiFill: {
        scanned: number
        enqueued: number
        updated: number
        nextCursor: string | null
        done: boolean
        sweeps: number
      } = {
        scanned: 0,
        enqueued: 0,
        updated: 0,
        nextCursor: bangumiCursor,
        done: true,
        sweeps: 0,
      }
      let pointFill: {
        scanned: number
        enqueued: number
        updated: number
        nextCursor: string | null
        done: boolean
        sweeps: number
      } = {
        scanned: 0,
        enqueued: 0,
        updated: 0,
        nextCursor: pointCursor,
        done: true,
        sweeps: 0,
      }

      const queueNotEmpty = !hasNoPendingLikeQueue()
      if (queueNotEmpty) {
        patchOneKeyProgress({
          currentStep: cycle - 1,
          totalSteps: Math.max(2, cycle + 1),
          roundProcessed: 0,
          detail: `第 ${cycle} 轮：当前队列未清空（pending/processing/failed 仍有任务），先处理现有任务，暂不补队...`,
        })
      } else {
        patchOneKeyProgress({
          currentStep: cycle - 1,
          totalSteps: Math.max(2, cycle + 1),
          roundProcessed: 0,
          detail: `第 ${cycle} 轮：无失败任务且队列已清空，补充新任务（作品 + 点位）...`,
        })

        const shouldSkipBackfill = hasNoMissingEntities()
        if (!shouldSkipBackfill) {
          const prevBangumiCursor = bangumiCursor
          const prevPointCursor = pointCursor
          bangumiFill = await backfillUntilProgress({
            entityType: 'anitabi_bangumi',
            cursor: bangumiCursor,
          })
          bangumiCursor = bangumiFill.done ? null : bangumiFill.nextCursor
          setBangumiBackfillCursor(bangumiCursor)

          pointFill = await backfillUntilProgress({
            entityType: 'anitabi_point',
            cursor: pointCursor,
          })
          pointCursor = pointFill.done ? null : pointFill.nextCursor
          setPointBackfillCursor(pointCursor)

          backfillScannedThisRound = bangumiFill.scanned + pointFill.scanned
          backfillEnqueuedThisRound = bangumiFill.enqueued + pointFill.enqueued
          backfillUpdatedThisRound = bangumiFill.updated + pointFill.updated
          backfillCursorAdvancedThisRound =
            String(prevBangumiCursor || '') !== String(bangumiCursor || '') ||
            String(prevPointCursor || '') !== String(pointCursor || '')
          backfillReachedEndThisRound = bangumiFill.done && pointFill.done
        }

        totalBackfillEnqueued += bangumiFill.enqueued + pointFill.enqueued
        totalBackfillUpdated += bangumiFill.updated + pointFill.updated
        totalBangumiBackfilled += bangumiFill.enqueued + bangumiFill.updated
        totalPointBackfilledEnqueued += pointFill.enqueued
        totalPointBackfilledUpdated += pointFill.updated
        if (bangumiFill.scanned > 0 || bangumiFill.enqueued > 0 || bangumiFill.updated > 0) {
          bangumiBatch += 1
        }

        await refreshQueueSnapshot()
        patchOneKeyProgress({
          currentStep: cycle - 1,
          totalSteps: Math.max(2, cycle + 1),
          roundProcessed: 0,
          detail: shouldSkipBackfill
            ? `第 ${cycle} 轮：当前无缺失项，跳过补队，开始处理 pending...`
            : `第 ${cycle} 轮：补队完成（作品 新建 ${bangumiFill.enqueued}/更新 ${bangumiFill.updated}，点位 新建 ${pointFill.enqueued}/更新 ${pointFill.updated}；扫描 作品 ${bangumiFill.scanned}/点位 ${pointFill.scanned}，扫段 作品 ${bangumiFill.sweeps}/点位 ${pointFill.sweeps}），开始处理 pending...`,
        })
      }

      const pendingRound = await executeRoundWithRetries('pending', cycle, '（处理 pending）')
      const pendingTranslationFailed = mergeRound(pendingRound)

      if (pendingRound.processed > 0) {
        progressedRounds += 1
        consecutiveNoProgress = 0
        await refreshQueueSnapshot()
        patchOneKeyProgress({
          currentStep: cycle,
          totalSteps: Math.max(2, cycle + 1),
          roundProcessed: pendingRound.processed,
          detail: `第 ${cycle} 轮：pending 处理完成（处理 ${pendingRound.processed}，成功 ${pendingRound.success}，翻译失败 ${pendingTranslationFailed}，回收 ${pendingRound.reclaimedProcessing}）`,
        })
        if (detectFailedOnlyStall({ roundSuccess: pendingRound.success, translationFailed: pendingTranslationFailed })) {
          patchOneKeyProgress({
            currentStep: cycle,
            totalSteps: Math.max(2, cycle + 1),
            roundProcessed: pendingRound.processed,
            detail: `第 ${cycle} 轮：连续仅失败无成功，停止重试并转入抽样发布...`,
          })
          break
        }
        continue
      }

      if (pendingRound.total === 0) {
        await refreshQueueSnapshot()
        if (hasNoMissingEntities() && hasNoPendingLikeQueue()) {
          completionState = 'done'
          patchOneKeyProgress({
            currentStep: cycle,
            totalSteps: Math.max(2, cycle + 1),
            roundProcessed: 0,
            detail: `第 ${cycle} 轮：没有失败任务、没有新补队任务、没有 pending，准备进入抽样发布...`,
          })
          break
        }

        if (
          backfillScannedThisRound > 0 &&
          backfillEnqueuedThisRound === 0 &&
          backfillUpdatedThisRound === 0 &&
          backfillCursorAdvancedThisRound &&
          !backfillReachedEndThisRound
        ) {
          consecutiveNoProgress = 0
          patchOneKeyProgress({
            currentStep: cycle,
            totalSteps: Math.max(2, cycle + 1),
            roundProcessed: 0,
            detail: `第 ${cycle} 轮：补队扫描推进中（本轮扫描 ${backfillScannedThisRound} 条，当前未命中新缺口），继续下一轮...`,
          })
          continue
        }

        consecutiveNoProgress += 1
        patchOneKeyProgress({
          currentStep: cycle,
          totalSteps: Math.max(2, cycle + 1),
          roundProcessed: 0,
          detail:
            hasNoPendingLikeQueue() && backfillReachedEndThisRound && backfillScannedThisRound > 0
              ? `第 ${cycle} 轮：补队已扫到末尾但未新增任务（扫描 ${backfillScannedThisRound}），仍存在缺口；疑似数据口径不一致（连续 ${consecutiveNoProgress} 轮）`
              : hasNoPendingLikeQueue()
                ? `第 ${cycle} 轮：pending 为 0，但仍有未覆盖实体（作品剩余 ${formatMetricCount(queueSnapshot.bangumiRemaining)}，点位剩余 ${formatMetricCount(queueSnapshot.pointRemaining)}），继续补队扫描（连续 ${consecutiveNoProgress} 轮）`
                : `第 ${cycle} 轮：pending 为 0，但队列仍未清空（可能存在 processing/failed），等待回收后继续（连续 ${consecutiveNoProgress} 轮）`,
        })
        if (consecutiveNoProgress >= MAP_ONE_KEY_MAX_CONSECUTIVE_FAILURES) {
          completionState = 'stopped'
          break
        }
        continue
      }

      if (pendingRound.total > 0) {
        consecutiveNoProgress += 1
        await refreshQueueSnapshot()
        patchOneKeyProgress({
          currentStep: cycle,
          totalSteps: Math.max(2, cycle + 1),
          roundProcessed: 0,
          detail: `第 ${cycle} 轮：pending 无进展（连续 ${consecutiveNoProgress} 轮）`,
        })
        if (consecutiveNoProgress >= MAP_ONE_KEY_MAX_CONSECUTIVE_FAILURES) {
          completionState = 'stopped'
          break
        }
        continue
      }
    }

    if (attemptedRounds >= MAP_ONE_KEY_MAX_ROUNDS && completionState !== 'done' && completionState !== 'stopped') {
      completionState = 'capped'
    }

    await refreshQueueSnapshot()

    let publishSummary = '未进入抽样发布阶段'
    const shouldRunPublish = completionState === 'done' || stoppedByFailedOnly
    if (shouldRunPublish) {
      patchOneKeyProgress({
        currentStep: attemptedRounds,
        totalSteps: Math.max(2, attemptedRounds + 1),
        roundProcessed: 0,
        detail: completionState === 'done' ? '全量翻译阶段完成，开始抽样检查并发布...' : '失败重试已触发保护停止，开始抽样检查并发布...',
      })

      const pool = await loadReadyMapTasks(300)
      if (pool.length > 0) {
        const sampleSize = Math.min(300, Math.max(50, Math.round(pool.length * 0.03)))
        const size = Math.min(sampleSize, pool.length)
        const shuffled = pool.slice().sort(() => Math.random() - 0.5)
        const sample = shuffled.slice(0, size)

        const publishRes = await fetch('/api/admin/translations/approve-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskIds: sample.map((task) => task.id),
          }),
        })
        const publishData = await publishRes.json().catch(() => ({}))
        if (!publishRes.ok) {
          throw new Error(publishData.error || '抽样发布失败')
        }
        allErrors = appendUniqueMessages(allErrors, collectErrorMessages((publishData as { results?: unknown })?.results))
        publishSummary = `抽样发布：样本 ${size}，通过 ${Number(publishData.approved || 0)}，失败 ${Number(publishData.failed || 0)}，跳过 ${Number(publishData.skipped || 0)}`
      } else {
        publishSummary = '抽样发布：当前没有 ready 任务，已跳过'
      }

      await refreshQueueSnapshot()
    }

    const reasonText = allErrors.length > 0 ? `；原因：${allErrors.join(' ｜ ')}` : ''
    const baseSummary = `共尝试 ${attemptedRounds} 轮，实际推进 ${progressedRounds} 轮，处理 ${totalProcessed}，成功 ${totalSuccess}，翻译失败 ${totalFailed}，回收 ${totalReclaimed}，跳过 ${totalSkipped}，补队新建 ${totalBackfillEnqueued}，补队更新 ${totalBackfillUpdated}`

    if (completionState === 'done') {
      const msg = `一键推进完成：${baseSummary}；${publishSummary}${reasonText}`
      setMapOpsMessage(msg)
      patchMapOpsProgress({
        running: false,
        currentStep: Math.max(1, attemptedRounds + 1),
        totalSteps: Math.max(2, attemptedRounds + 1),
        processed: totalProcessed,
        success: totalSuccess,
        failed: totalFailed,
        reclaimed: totalReclaimed,
        skipped: totalSkipped,
        errors: allErrors,
        detail: msg,
        oneKey: buildOneKeyMetrics(0),
      })
      toast.success(`一键推进完成：处理 ${totalProcessed} 条`)
    } else if (completionState === 'stopped') {
      const msg =
        stoppedByFailedOnly
          ? `一键推进已暂停：连续 ${MAP_ONE_KEY_MAX_CONSECUTIVE_FAILED_ONLY} 轮仅失败无成功，已停止重试并执行抽样发布。${baseSummary}；${publishSummary}${reasonText}`
          : `一键推进已暂停：连续 ${consecutiveNoProgress} 轮无进展，自动停止。${baseSummary}${reasonText}`
      setMapOpsMessage(msg)
      patchMapOpsProgress({
        running: false,
        currentStep: Math.max(1, attemptedRounds),
        totalSteps: Math.max(2, attemptedRounds),
        processed: totalProcessed,
        success: totalSuccess,
        failed: totalFailed,
        reclaimed: totalReclaimed,
        skipped: totalSkipped,
        errors: allErrors,
        detail: msg,
        oneKey: buildOneKeyMetrics(0),
      })
      if (stoppedByFailedOnly) {
        toast.info('一键推进已停止重复失败重试，并已执行抽样发布')
      } else {
        toast.error('一键推进已暂停：连续失败过多')
      }
    } else {
      const msg = `一键推进达到安全上限 ${MAP_ONE_KEY_MAX_ROUNDS} 轮，自动暂停。${baseSummary}${reasonText}`
      setMapOpsMessage(msg)
      patchMapOpsProgress({
        running: false,
        currentStep: Math.max(1, attemptedRounds),
        totalSteps: Math.max(2, attemptedRounds),
        processed: totalProcessed,
        success: totalSuccess,
        failed: totalFailed,
        reclaimed: totalReclaimed,
        skipped: totalSkipped,
        errors: allErrors,
        detail: msg,
        oneKey: buildOneKeyMetrics(0),
      })
      toast.info('一键推进达到安全上限，已暂停')
    }

    await reload()
  } catch (error) {
    const msg = normalizeFetchErrorMessage(error, '一键推进失败')
    setMapOpsMessage(msg)
    patchMapOpsProgress({
      running: false,
      failed: 1,
      errors: [msg],
      detail: msg,
    })
    toast.error(msg)
  } finally {
    setMapOpsLoading(false)
  }
}
