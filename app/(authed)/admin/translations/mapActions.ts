import type { TranslationTaskListItem } from '@/lib/translation/adminDashboard'
import { handleOneKeyAdvanceMapQueue as runOneKeyMapOrchestrator } from './oneKeyMapOrchestrator'
import {
  APPROVE_ALL_NON_MAP_CONCURRENCY,
  APPROVE_ALL_READY_MAX_ROUNDS,
  APPROVE_ALL_READY_PAGE_SIZE,
  MAP_EXECUTE_LIMIT_FAILED_PER_TYPE,
  MAP_EXECUTE_LIMIT_PENDING_PER_TYPE,
  collectErrorMessages,
  appendUniqueMessages,
  normalizeFetchErrorMessage,
  loadMapStatusSnapshot,
  postExecuteTasks,
  type MapExecuteStatusScope,
  type MapExecutionSummary,
  type MapOpsProgress,
  type MapStatusSnapshot,
} from './helpers'
type ToastApi = {
  success: (...args: any[]) => void
  info: (...args: any[]) => void
  error: (...args: any[]) => void
}
type ConfirmApi = (input: {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
}) => Promise<boolean>
type BackfillInput = {
  entityType: 'anitabi_bangumi' | 'anitabi_point'
  mode: 'missing' | 'stale' | 'all'
  limit?: number
  cursor?: string | null
}
type BackfillResult = {
  scanned: number
  enqueued: number
  updated: number
  nextCursor: string | null
  done: boolean
}
type CreateTranslationsMapActionsDeps = {
  targetLanguage: string
  bangumiBackfillCursor: string | null
  pointBackfillCursor: string | null
  mapOpsProgress: MapOpsProgress | null
  entityTypeLabels: Record<string, string>
  askForConfirm: ConfirmApi
  toast: ToastApi
  setMapOpsLoading: (value: boolean) => void
  setMapOpsMessage: (value: string | null) => void
  setBangumiBackfillCursor: (value: string | null) => void
  setPointBackfillCursor: (value: string | null) => void
  setSampleApproving: (value: boolean) => void
  setApproveAllReadyRunning: (value: boolean) => void
  beginMapOpsProgress: (input: { title: string; totalSteps: number; detail: string }) => void
  patchMapOpsProgress: (patch: Partial<MapOpsProgress>) => void
  loadOneKeyMapQueueSnapshot: (targetLanguage: string) => Promise<{
    bangumiRemaining: number | null
    pointRemaining: number | null
    bangumiQueueOpen: number | null
    pointQueueOpen: number | null
    bangumiPendingLike: number | null
    pointPendingLike: number | null
    estimatedUnfinishedTasks: number | null
  }>
  reloadAll: () => Promise<void>
}
export function createTranslationsMapActions(deps: CreateTranslationsMapActionsDeps) {
  const {
    targetLanguage,
    bangumiBackfillCursor,
    pointBackfillCursor,
    mapOpsProgress,
    entityTypeLabels,
    askForConfirm,
    toast,
    setMapOpsLoading,
    setMapOpsMessage,
    setBangumiBackfillCursor,
    setPointBackfillCursor,
    setSampleApproving,
    setApproveAllReadyRunning,
    beginMapOpsProgress,
    patchMapOpsProgress,
    loadOneKeyMapQueueSnapshot,
    reloadAll,
  } = deps
  async function runMapBackfillOnce(input: BackfillInput): Promise<BackfillResult> {
    const res = await fetch('/api/admin/translations/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: input.entityType,
        targetLanguages: ['en', 'ja'],
        mode: input.mode,
        limit: input.limit ?? 1000,
        cursor: input.cursor || undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '回填任务创建失败')
    return {
      scanned: Number(data.scanned || 0),
      enqueued: Number(data.enqueued || 0),
      updated: Number(data.updated || 0),
      nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null,
      done: Boolean(data.done),
    }
  }
  async function handleMapBackfill(entityType: 'anitabi_bangumi' | 'anitabi_point') {
    setMapOpsLoading(true)
    setMapOpsMessage(null)
    const actionLabel = entityTypeLabels[entityType]
    beginMapOpsProgress({
      title: `${actionLabel}回填`,
      totalSteps: 1,
      detail: `正在扫描并创建 ${actionLabel} 翻译任务...`,
    })
    try {
      const cursor = entityType === 'anitabi_bangumi' ? bangumiBackfillCursor : pointBackfillCursor
      const result = await runMapBackfillOnce({
        entityType,
        mode: 'all',
        limit: 1000,
        cursor,
      })
      if (entityType === 'anitabi_bangumi') {
        setBangumiBackfillCursor(result.done ? null : result.nextCursor)
      } else {
        setPointBackfillCursor(result.done ? null : result.nextCursor)
      }
      setMapOpsMessage(
        `${entityTypeLabels[entityType]}：扫描 ${result.scanned}，新建 ${result.enqueued}，更新 ${result.updated}${result.done ? '（当前回填已完成）' : `（可继续，cursor=${result.nextCursor || '-'})`}`
      )
      patchMapOpsProgress({
        running: false,
        currentStep: 1,
        processed: result.scanned,
        success: result.enqueued,
        skipped: result.updated,
        errors: [],
        detail: `回填完成：扫描 ${result.scanned}，新建 ${result.enqueued}，更新 ${result.updated}${result.done ? '（当前回填已完成）' : ''}`,
      })
      toast.success(`${entityTypeLabels[entityType]}回填已执行`)
      await reloadAll()
    } catch (error) {
      const msg = error instanceof Error ? error.message : '回填任务创建失败'
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
  async function handleMapIncrementalRefill() {
    setMapOpsLoading(true)
    setMapOpsMessage(null)
    beginMapOpsProgress({
      title: '地图增量补队',
      totalSteps: 2,
      detail: '正在补队地图作品...',
    })
    try {
      const bangumiResult = await runMapBackfillOnce({ entityType: 'anitabi_bangumi', mode: 'stale', limit: 1000 })
      patchMapOpsProgress({
        currentStep: 1,
        processed: bangumiResult.scanned,
        success: bangumiResult.enqueued,
        skipped: bangumiResult.updated,
        errors: [],
        detail: `作品补队完成：新建 ${bangumiResult.enqueued}，更新 ${bangumiResult.updated}。正在补队点位...`,
      })
      const pointResult = await runMapBackfillOnce({ entityType: 'anitabi_point', mode: 'stale', limit: 1000 })
      setMapOpsMessage(
        `增量补队完成：作品 新建 ${bangumiResult.enqueued}/更新 ${bangumiResult.updated}，点位 新建 ${pointResult.enqueued}/更新 ${pointResult.updated}`
      )
      patchMapOpsProgress({
        running: false,
        currentStep: 2,
        processed: bangumiResult.scanned + pointResult.scanned,
        success: bangumiResult.enqueued + pointResult.enqueued,
        skipped: bangumiResult.updated + pointResult.updated,
        errors: [],
        detail: `增量补队完成：作品 新建 ${bangumiResult.enqueued}/更新 ${bangumiResult.updated}，点位 新建 ${pointResult.enqueued}/更新 ${pointResult.updated}`,
      })
      toast.success('地图增量补队已执行')
      await reloadAll()
    } catch (error) {
      const msg = error instanceof Error ? error.message : '增量补队失败'
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
  async function executeMapTranslateRound(input?: {
    statusScope?: MapExecuteStatusScope
    limitPerType?: number
    concurrency?: number
  }): Promise<MapExecutionSummary> {
    const statusScope: MapExecuteStatusScope = input?.statusScope || 'pending'
    const limitPerType = Math.max(
      1,
      Math.floor(input?.limitPerType ?? (statusScope === 'failed' ? MAP_EXECUTE_LIMIT_FAILED_PER_TYPE : MAP_EXECUTE_LIMIT_PENDING_PER_TYPE))
    )
    const concurrency = Math.max(1, Math.floor(input?.concurrency ?? (statusScope === 'failed' ? 1 : 2)))
    const summary: MapExecutionSummary = {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      reclaimedProcessing: 0,
      errorMessages: [],
    }
    const requestErrors: string[] = []
    let beforeSnapshot: MapStatusSnapshot | null = null
    try {
      beforeSnapshot = await loadMapStatusSnapshot(targetLanguage)
    } catch {
      beforeSnapshot = null
    }
    for (const entityType of ['anitabi_bangumi', 'anitabi_point'] as const) {
      try {
        const data = await postExecuteTasks({
          entityType,
          targetLanguage: targetLanguage === 'all' ? undefined : targetLanguage,
          limit: limitPerType,
          includeFailed: statusScope !== 'pending',
          statusScope,
          concurrency,
        })
        summary.total += Number(data.total || 0)
        summary.processed += Number(data.processed || 0)
        summary.success += Number(data.success || 0)
        summary.failed += Number(data.failed || 0)
        summary.skipped += Number(data.skipped || 0)
        summary.reclaimedProcessing += Number(data.reclaimedProcessing || 0)
        summary.errorMessages.push(...collectErrorMessages(data.results))
      } catch (error) {
        requestErrors.push(normalizeFetchErrorMessage(error, `${entityType} 执行失败`))
      }
    }
    if (summary.reclaimedProcessing > 0) {
      summary.errorMessages.unshift(`已回收 ${summary.reclaimedProcessing} 条长时间 processing 的任务（标记为 failed）`)
    }
    if (requestErrors.length > 0) {
      summary.errorMessages.push(...requestErrors)
      try {
        const afterSnapshot = await loadMapStatusSnapshot(targetLanguage)
        if (beforeSnapshot) {
          const successDelta = Math.max(0, afterSnapshot.ready - beforeSnapshot.ready)
          const failedDelta = Math.max(0, afterSnapshot.failed - beforeSnapshot.failed)
          const processedDelta = successDelta + failedDelta
          if (processedDelta > summary.processed) {
            summary.processed = processedDelta
            summary.success = Math.max(summary.success, successDelta)
            summary.failed = Math.max(summary.failed, failedDelta)
            summary.total = Math.max(summary.total, processedDelta)
            const estimatedFailedWithoutReclaimed = Math.max(0, failedDelta - summary.reclaimedProcessing)
            summary.errorMessages.push(
              `本轮请求超时，但后台已推进：估算成功 ${successDelta}，翻译失败 ${estimatedFailedWithoutReclaimed}，回收 ${summary.reclaimedProcessing}（按状态差值）`
            )
          }
        }
      } catch {
        // ignore snapshot fallback error
      }
    }
    summary.errorMessages = Array.from(new Set(summary.errorMessages)).slice(0, 6)
    if (summary.processed === 0 && requestErrors.length > 0) {
      summary.errorMessages.unshift('本轮未拿到有效执行结果，可能是网关超时；任务状态可能未变化')
    }
    return summary
  }
  async function executeMapSingleRound(input: {
    statusScope: MapExecuteStatusScope
    title: string
    loadingDetail: string
    successPrefix: string
    failFallback: string
  }) {
    setMapOpsLoading(true)
    setMapOpsMessage(null)
    beginMapOpsProgress({
      title: input.title,
      totalSteps: 1,
      detail: input.loadingDetail,
    })
    try {
      const round = await executeMapTranslateRound({ statusScope: input.statusScope })
      const translationFailed = Math.max(0, round.failed - round.reclaimedProcessing)
      const errorText = round.errorMessages.length > 0 ? `；原因：${round.errorMessages.join(' ｜ ')}` : ''
      setMapOpsMessage(
        `${input.successPrefix}：处理 ${round.processed}，成功 ${round.success}，翻译失败 ${translationFailed}，回收 ${round.reclaimedProcessing}，跳过 ${round.skipped}${errorText}`
      )
      patchMapOpsProgress({
        running: false,
        currentStep: 1,
        processed: round.processed,
        success: round.success,
        failed: translationFailed,
        reclaimed: round.reclaimedProcessing,
        skipped: round.skipped,
        errors: round.errorMessages,
        detail: `${input.successPrefix}：处理 ${round.processed}，成功 ${round.success}，翻译失败 ${translationFailed}，回收 ${round.reclaimedProcessing}，跳过 ${round.skipped}${errorText}`,
      })
      if (round.processed > 0) {
        toast.success(`${input.successPrefix}：处理 ${round.processed}`)
      } else if (round.errorMessages.length > 0) {
        toast.info('本轮未推进，可能是网关超时，请稍后重试')
      } else {
        toast.info('本轮没有可处理的任务')
      }
      await reloadAll()
    } catch (error) {
      const msg = normalizeFetchErrorMessage(error, input.failFallback)
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
  async function executeMapPendingBatch() {
    await executeMapSingleRound({
      statusScope: 'pending',
      title: '执行地图待翻译（单轮）',
      loadingDetail: '正在执行 pending 地图翻译任务（作品 + 点位）...',
      successPrefix: '单轮执行完成',
      failFallback: '地图批量执行失败',
    })
  }
  async function executeMapFailedBatch() {
    await executeMapSingleRound({
      statusScope: 'failed',
      title: '重试地图失败任务（单轮）',
      loadingDetail: '正在重试 failed 地图任务（作品 + 点位）...',
      successPrefix: '失败任务重试完成',
      failFallback: '地图失败任务重试失败',
    })
  }
  async function loadReadyMapTasks(limitPerType: number): Promise<TranslationTaskListItem[]> {
    const [bangumiRes, pointRes] = await Promise.all([
      fetch(`/api/admin/translations?status=ready&entityType=anitabi_bangumi&page=1&pageSize=${limitPerType}`),
      fetch(`/api/admin/translations?status=ready&entityType=anitabi_point&page=1&pageSize=${limitPerType}`),
    ])
    const [bangumiData, pointData] = await Promise.all([
      bangumiRes.json().catch(() => ({})),
      pointRes.json().catch(() => ({})),
    ])
    if (!bangumiRes.ok) throw new Error(bangumiData.error || '获取地图作品待审核任务失败')
    if (!pointRes.ok) throw new Error(pointData.error || '获取地图点位待审核任务失败')
    const bangumiTasks = Array.isArray(bangumiData.tasks) ? (bangumiData.tasks as TranslationTaskListItem[]) : []
    const pointTasks = Array.isArray(pointData.tasks) ? (pointData.tasks as TranslationTaskListItem[]) : []
    return [...bangumiTasks, ...pointTasks]
  }
  async function handleOneKeyAdvanceMapQueue() {
    await runOneKeyMapOrchestrator({
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
      reload: reloadAll,
      toast,
    })
  }
  async function handleManualAdvanceMapQueue(maxRounds = 10) {
    setMapOpsLoading(true)
    setMapOpsMessage(null)
    try {
      const rounds = Math.max(1, Math.min(20, Math.floor(maxRounds)))
      beginMapOpsProgress({
        title: `手动推进地图队列（最多 ${rounds} 轮）`,
        totalSteps: rounds,
        detail: `准备执行第 1 / ${rounds} 轮...`,
      })
      let roundCount = 0
      let totalProcessed = 0
      let totalSuccess = 0
      let totalFailed = 0
      let totalReclaimed = 0
      let totalSkipped = 0
      let queueDrained = false
      const allErrors: string[] = []
      for (let i = 0; i < rounds; i += 1) {
        patchMapOpsProgress({
          currentStep: i,
          processed: totalProcessed,
          success: totalSuccess,
          failed: totalFailed,
          reclaimed: totalReclaimed,
          skipped: totalSkipped,
          detail: `正在执行第 ${i + 1} / ${rounds} 轮...`,
        })
        const round = await executeMapTranslateRound({ statusScope: 'pending' })
        if (round.total === 0 || round.processed === 0) {
          queueDrained = true
          break
        }
        roundCount += 1
        totalProcessed += round.processed
        totalSuccess += round.success
        totalFailed += Math.max(0, round.failed - round.reclaimedProcessing)
        totalReclaimed += round.reclaimedProcessing
        totalSkipped += round.skipped
        if (round.errorMessages.length > 0) {
          for (const message of round.errorMessages) {
            if (!allErrors.includes(message)) {
              allErrors.push(message)
              if (allErrors.length >= 6) break
            }
          }
        }
        patchMapOpsProgress({
          currentStep: i + 1,
          processed: totalProcessed,
          success: totalSuccess,
          failed: totalFailed,
          reclaimed: totalReclaimed,
          skipped: totalSkipped,
          errors: allErrors,
          detail: `第 ${i + 1} 轮完成：本轮处理 ${round.processed}（成功 ${round.success}，翻译失败 ${Math.max(0, round.failed - round.reclaimedProcessing)}，回收 ${round.reclaimedProcessing}）`,
        })
      }
      if (roundCount === 0) {
        setMapOpsMessage('当前没有 pending 的地图翻译任务，队列已是最新状态')
        patchMapOpsProgress({
          running: false,
          currentStep: 1,
          totalSteps: 1,
          errors: [],
          detail: '当前没有 pending 的地图翻译任务，队列已是最新状态',
        })
        toast.info('当前没有 pending 的地图翻译任务')
        return
      }
      const suffix = queueDrained ? '（队列已清空）' : `（达到手动推进上限 ${rounds} 轮）`
      const errorText = allErrors.length > 0 ? `；原因：${allErrors.join(' ｜ ')}` : ''
      setMapOpsMessage(
        `手动推进完成：共 ${roundCount} 轮，处理 ${totalProcessed}，成功 ${totalSuccess}，翻译失败 ${totalFailed}，回收 ${totalReclaimed}，跳过 ${totalSkipped}${suffix}${errorText}`
      )
      patchMapOpsProgress({
        running: false,
        currentStep: queueDrained ? roundCount : rounds,
        totalSteps: queueDrained ? roundCount : rounds,
        processed: totalProcessed,
        success: totalSuccess,
        failed: totalFailed,
        reclaimed: totalReclaimed,
        skipped: totalSkipped,
        errors: allErrors,
        detail: `手动推进完成：共 ${roundCount} 轮，处理 ${totalProcessed}，成功 ${totalSuccess}，翻译失败 ${totalFailed}，回收 ${totalReclaimed}，跳过 ${totalSkipped}${suffix}${errorText}`,
      })
      toast.success(`手动推进完成：处理 ${totalProcessed} 条`)
      await reloadAll()
    } catch (error) {
      const msg = normalizeFetchErrorMessage(error, '手动推进失败')
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
  async function loadReadyTasksPage(pageSize: number): Promise<{ tasks: TranslationTaskListItem[]; total: number }> {
    const res = await fetch(`/api/admin/translations?status=ready&entityType=all&targetLanguage=all&page=1&pageSize=${pageSize}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '获取待审核任务失败')
    return {
      tasks: Array.isArray(data.tasks) ? (data.tasks as TranslationTaskListItem[]) : [],
      total: Number(data.total || 0),
    }
  }
  async function loadReadyCountAll(): Promise<number | null> {
    const res = await fetch('/api/admin/translations/stats?entityType=all&targetLanguage=all')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return null
    const counts = (data as { counts?: Record<string, number> })?.counts
    if (!counts || typeof counts !== 'object') return null
    return Number(counts.ready || 0)
  }
  async function approveSingleTask(taskId: string): Promise<{ status: 'approved' | 'failed'; error?: string }> {
    try {
      const res = await fetch(`/api/admin/translations/${encodeURIComponent(taskId)}/approve`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { status: 'failed', error: String(data.error || `任务 ${taskId} 审核失败（HTTP ${res.status}）`) }
      }
      return { status: 'approved' }
    } catch (error) {
      return {
        status: 'failed',
        error: normalizeFetchErrorMessage(error, `任务 ${taskId} 审核失败`),
      }
    }
  }
  async function approveAllReadyTasks() {
    const accepted = await askForConfirm({
      title: '确认一键审核全部待审核',
      description: '将直接通过当前所有 ready 任务（文章 / 城市 / 动漫 / 地图），请确认。',
      confirmLabel: '确认全部通过',
      cancelLabel: '取消',
    })
    if (!accepted) return
    setApproveAllReadyRunning(true)
    setMapOpsLoading(true)
    setMapOpsMessage(null)
    try {
      let estimatedTotal = await loadReadyCountAll()
      beginMapOpsProgress({
        title: '一键审核全部待审核',
        totalSteps: Math.max(1, estimatedTotal ?? 1),
        detail: estimatedTotal !== null ? `准备开始：当前待审核 ${estimatedTotal} 条...` : '准备开始：拉取待审核任务...',
      })
      let rounds = 0
      let totalProcessed = 0
      let totalApproved = 0
      let totalFailed = 0
      let totalSkipped = 0
      let remainingReady: number | null = estimatedTotal
      let allErrors: string[] = []
      let stoppedByNoProgress = false
      for (let round = 1; round <= APPROVE_ALL_READY_MAX_ROUNDS; round += 1) {
        rounds = round
        const page = await loadReadyTasksPage(APPROVE_ALL_READY_PAGE_SIZE)
        const readyTasks = page.tasks
        if (readyTasks.length === 0) {
          remainingReady = 0
          break
        }
        let roundProcessed = 0
        let roundApproved = 0
        let roundFailed = 0
        let roundSkipped = 0
        const mapTaskIds = readyTasks
          .filter((task) => task.entityType === 'anitabi_bangumi' || task.entityType === 'anitabi_point')
          .map((task) => task.id)
        const nonMapTaskIds = readyTasks
          .filter((task) => task.entityType !== 'anitabi_bangumi' && task.entityType !== 'anitabi_point')
          .map((task) => task.id)
        if (mapTaskIds.length > 0) {
          try {
            const res = await fetch('/api/admin/translations/approve-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskIds: mapTaskIds }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
              roundProcessed += mapTaskIds.length
              roundFailed += mapTaskIds.length
              allErrors = appendUniqueMessages(allErrors, [String(data.error || '地图批量审核失败')])
            } else {
              roundProcessed += Number(data.total || mapTaskIds.length)
              roundApproved += Number(data.approved || 0)
              roundFailed += Number(data.failed || 0)
              roundSkipped += Number(data.skipped || 0)
              allErrors = appendUniqueMessages(allErrors, collectErrorMessages((data as { results?: unknown })?.results))
            }
          } catch (error) {
            roundProcessed += mapTaskIds.length
            roundFailed += mapTaskIds.length
            allErrors = appendUniqueMessages(allErrors, [normalizeFetchErrorMessage(error, '地图批量审核失败')])
          }
        }
        if (nonMapTaskIds.length > 0) {
          for (let i = 0; i < nonMapTaskIds.length; i += APPROVE_ALL_NON_MAP_CONCURRENCY) {
            const chunk = nonMapTaskIds.slice(i, i + APPROVE_ALL_NON_MAP_CONCURRENCY)
            const results = await Promise.all(chunk.map((taskId) => approveSingleTask(taskId)))
            roundProcessed += results.length
            for (const item of results) {
              if (item.status === 'approved') {
                roundApproved += 1
              } else {
                roundFailed += 1
                if (item.error) {
                  allErrors = appendUniqueMessages(allErrors, [item.error])
                }
              }
            }
          }
        }
        if (roundProcessed === 0) {
          stoppedByNoProgress = true
          allErrors = appendUniqueMessages(allErrors, ['本轮未处理任何待审核任务，为避免死循环已停止'])
          break
        }
        totalProcessed += roundProcessed
        totalApproved += roundApproved
        totalFailed += roundFailed
        totalSkipped += roundSkipped
        const readyCount = await loadReadyCountAll()
        remainingReady = readyCount
        if (readyCount !== null) {
          const candidate = totalProcessed + readyCount
          estimatedTotal = estimatedTotal === null ? candidate : Math.max(estimatedTotal, candidate)
        } else if (estimatedTotal === null || estimatedTotal < totalProcessed) {
          estimatedTotal = totalProcessed
        }
        const totalSteps = Math.max(1, estimatedTotal ?? totalProcessed)
        const currentStep =
          remainingReady !== null
            ? Math.max(0, Math.min(totalSteps, totalSteps - remainingReady))
            : Math.max(0, Math.min(totalSteps, totalProcessed))
        patchMapOpsProgress({
          currentStep,
          totalSteps,
          processed: totalProcessed,
          success: totalApproved,
          failed: totalFailed,
          reclaimed: 0,
          skipped: totalSkipped,
          errors: allErrors,
          detail: `第 ${round} 轮：处理 ${roundProcessed}（通过 ${roundApproved}，失败 ${roundFailed}，跳过 ${roundSkipped}）${remainingReady !== null ? `，剩余待审核 ${remainingReady}` : ''}`,
        })
        if (remainingReady === 0) break
      }
      const finished = remainingReady === 0
      const reasonText = allErrors.length > 0 ? `；原因：${allErrors.join(' ｜ ')}` : ''
      const summary = `共 ${rounds} 轮，处理 ${totalProcessed}，通过 ${totalApproved}，失败 ${totalFailed}，跳过 ${totalSkipped}`
      const stopText = stoppedByNoProgress ? '本轮无进展已停止' : `剩余待审核 ${remainingReady ?? '-'}`
      const message = finished ? `一键审核完成：${summary}${reasonText}` : `一键审核暂停：${summary}，${stopText}${reasonText}`
      setMapOpsMessage(message)
      patchMapOpsProgress({
        running: false,
        currentStep: Math.max(1, Math.min(Math.max(1, estimatedTotal ?? totalProcessed), totalProcessed)),
        totalSteps: Math.max(1, estimatedTotal ?? totalProcessed),
        processed: totalProcessed,
        success: totalApproved,
        failed: totalFailed,
        reclaimed: 0,
        skipped: totalSkipped,
        errors: allErrors,
        detail: message,
      })
      if (finished) {
        toast.success(`一键审核完成：通过 ${totalApproved}`)
      } else {
        toast.info('一键审核已暂停，请查看失败原因')
      }
      await reloadAll()
    } catch (error) {
      const msg = normalizeFetchErrorMessage(error, '一键审核失败')
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
      setApproveAllReadyRunning(false)
    }
  }
  async function approveMapSampleBatch() {
    setSampleApproving(true)
    try {
      const pool = await loadReadyMapTasks(300)
      if (pool.length === 0) {
        toast.info('当前没有可抽检发布的地图 ready 任务')
        return
      }
      const sampleSize = Math.min(300, Math.max(50, Math.round(pool.length * 0.03)))
      const size = Math.min(sampleSize, pool.length)
      const shuffled = pool.slice().sort(() => Math.random() - 0.5)
      const sample = shuffled.slice(0, size)
      const accepted = await askForConfirm({
        title: '确认抽检并批量发布',
        description: `将从 ready 任务中抽取 ${size} 条样本并执行批量发布。`,
        confirmLabel: '确认发布',
        cancelLabel: '取消',
      })
      if (!accepted) return
      beginMapOpsProgress({
        title: '抽检并批量发布',
        totalSteps: 2,
        detail: `正在发布 ${size} 条抽检任务...`,
      })
      const res = await fetch('/api/admin/translations/approve-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskIds: sample.map((task) => task.id),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '抽检发布失败')
      patchMapOpsProgress({
        currentStep: 1,
        processed: Number(data.total || size),
        success: Number(data.approved || 0),
        failed: Number(data.failed || 0),
        skipped: Number(data.skipped || 0),
        errors: collectErrorMessages((data as { results?: unknown })?.results),
        detail: `抽检发布已应用：通过 ${data.approved || 0}，失败 ${data.failed || 0}，跳过 ${data.skipped || 0}。正在刷新列表...`,
      })
      setMapOpsMessage(`抽检发布完成：通过 ${data.approved || 0}，失败 ${data.failed || 0}，跳过 ${data.skipped || 0}`)
      toast.success(`抽检发布完成：通过 ${data.approved || 0}`)
      await reloadAll()
      patchMapOpsProgress({
        running: false,
        currentStep: 2,
        errors: collectErrorMessages((data as { results?: unknown })?.results),
        detail: `抽检发布完成：通过 ${data.approved || 0}，失败 ${data.failed || 0}，跳过 ${data.skipped || 0}`,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : '抽检发布失败'
      setMapOpsMessage(msg)
      patchMapOpsProgress({
        running: false,
        failed: mapOpsProgress ? mapOpsProgress.failed || 1 : 1,
        errors: [msg],
        detail: msg,
      })
      toast.error(msg)
    } finally {
      setSampleApproving(false)
    }
  }
  return {
    runMapBackfillOnce,
    handleMapBackfill,
    handleMapIncrementalRefill,
    executeMapTranslateRound,
    executeMapPendingBatch,
    executeMapFailedBatch,
    handleOneKeyAdvanceMapQueue,
    handleManualAdvanceMapQueue,
    loadReadyMapTasks,
    approveAllReadyTasks,
    approveMapSampleBatch,
  }
}
