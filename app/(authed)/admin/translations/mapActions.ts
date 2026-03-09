import {
  normalizeFetchErrorMessage,
  type MapExecuteStatusScope,
  type MapOpsProgress,
} from './helpers'

type ToastApi = {
  success: (message: string, title?: string) => unknown
  info: (message: string, title?: string) => unknown
  error: (message: string, title?: string) => unknown
}

type ConfirmApi = (input: {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
}) => Promise<boolean>

type MapOpsResponse = {
  ok: boolean
  action: string
  done: boolean
  message: string
  bangumiBackfillCursor: string | null
  pointBackfillCursor: string | null
  continuation: Record<string, unknown> | null
  snapshot: Omit<MapOpsProgress, 'title' | 'running'> & {
    oneKey: MapOpsProgress['oneKey']
  }
}

type CreateTranslationsMapActionsDeps = {
  targetLanguage: string
  bangumiBackfillCursor: string | null
  pointBackfillCursor: string | null
  entityTypeLabels: Record<string, string>
  askForConfirm: ConfirmApi
  toast: ToastApi
  setMapOpsLoading: (value: boolean) => void
  setMapOpsMessage: (value: string | null) => void
  setBangumiBackfillCursor: (value: string | null) => void
  setPointBackfillCursor: (value: string | null) => void
  setSampleApproving: (value: boolean) => void
  setApproveAllReadyRunning: (value: boolean) => void
  beginMapOpsProgress: (input: {
    title: string
    totalSteps: number
    detail: string
  }) => void
  patchMapOpsProgress: (patch: Partial<MapOpsProgress>) => void
  reloadAll: () => Promise<void>
}

async function postMapOps(
  body: Record<string, unknown>
): Promise<MapOpsResponse> {
  const res = await fetch('/api/admin/translations/map-ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(String(data.error || '地图操作失败'))
  }
  return data as MapOpsResponse
}

export function createTranslationsMapActions(
  deps: CreateTranslationsMapActionsDeps
) {
  const {
    targetLanguage,
    bangumiBackfillCursor,
    pointBackfillCursor,
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
    reloadAll,
  } = deps

  function applyMapOpsResult(
    title: string,
    result: MapOpsResponse,
    input?: { running?: boolean }
  ) {
    setMapOpsMessage(result.message)
    setBangumiBackfillCursor(result.bangumiBackfillCursor)
    setPointBackfillCursor(result.pointBackfillCursor)
    patchMapOpsProgress({
      title,
      running: input?.running ?? !result.done,
      currentStep: result.snapshot.currentStep,
      totalSteps: result.snapshot.totalSteps,
      processed: result.snapshot.processed,
      success: result.snapshot.success,
      failed: result.snapshot.failed,
      reclaimed: result.snapshot.reclaimed,
      skipped: result.snapshot.skipped,
      errors: result.snapshot.errors,
      detail: result.snapshot.detail,
      oneKey: result.snapshot.oneKey,
    })
  }

  async function runSingleAction(input: {
    title: string
    loadingDetail: string
    body: Record<string, unknown>
    successMessage?: string
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
      const result = await postMapOps(input.body)
      applyMapOpsResult(input.title, result, { running: false })
      if (input.successMessage) {
        toast.success(input.successMessage)
      } else {
        toast.success(result.message)
      }
      await reloadAll()
    } catch (error) {
      const message = normalizeFetchErrorMessage(error, input.failFallback)
      setMapOpsMessage(message)
      patchMapOpsProgress({
        running: false,
        failed: 1,
        errors: [message],
        detail: message,
      })
      toast.error(message)
    } finally {
      setMapOpsLoading(false)
    }
  }

  async function handleMapBackfill(entityType: 'anitabi_bangumi' | 'anitabi_point') {
    await runSingleAction({
      title: `${entityTypeLabels[entityType]}回填`,
      loadingDetail: `正在扫描并创建 ${entityTypeLabels[entityType]} 翻译任务...`,
      body: {
        action: 'backfill_once',
        targetLanguage: 'all',
        entityType,
        mode: 'all',
        continuation: {
          bangumiBackfillCursor,
          pointBackfillCursor,
        },
      },
      successMessage: `${entityTypeLabels[entityType]}回填已执行`,
      failFallback: '回填任务创建失败',
    })
  }

  async function handleMapIncrementalRefill() {
    await runSingleAction({
      title: '地图增量补队',
      loadingDetail: '正在补队地图作品与点位...',
      body: {
        action: 'incremental_refill',
        targetLanguage: 'all',
      },
      successMessage: '地图增量补队已执行',
      failFallback: '增量补队失败',
    })
  }

  async function executeMapBatch(
    statusScope: MapExecuteStatusScope,
    title: string,
    loadingDetail: string,
    failFallback: string
  ) {
    await runSingleAction({
      title,
      loadingDetail,
      body: {
        action: 'execute_round',
        targetLanguage,
        statusScope,
        limitPerType: statusScope === 'failed' ? 10 : 20,
        concurrency: statusScope === 'failed' ? 1 : 2,
      },
      failFallback,
    })
  }

  async function executeMapPendingBatch() {
    await executeMapBatch(
      'pending',
      '执行地图待翻译（单轮）',
      '正在执行 pending 地图翻译任务（作品 + 点位）...',
      '地图批量执行失败'
    )
  }

  async function executeMapFailedBatch() {
    await executeMapBatch(
      'failed',
      '重试地图失败任务（单轮）',
      '正在重试 failed 地图任务（作品 + 点位）...',
      '地图失败任务重试失败'
    )
  }

  async function handleManualAdvanceMapQueue(maxRounds = 10) {
    await runSingleAction({
      title: `手动推进地图队列（最多 ${maxRounds} 轮）`,
      loadingDetail: `正在执行最多 ${maxRounds} 轮 pending 地图任务...`,
      body: {
        action: 'manual_advance',
        targetLanguage,
        maxRounds,
      },
      failFallback: '手动推进失败',
    })
  }

  async function handleOneKeyAdvanceMapQueue() {
    setMapOpsLoading(true)
    setMapOpsMessage(null)
    beginMapOpsProgress({
      title: '一键推进地图队列',
      totalSteps: 1,
      detail: '准备开始：服务端推进地图队列...',
    })

    try {
      let continuation: Record<string, unknown> | null = {
        bangumiBackfillCursor,
        pointBackfillCursor,
      }
      let lastResult: MapOpsResponse | null = null

      for (let index = 0; index < 25; index += 1) {
        const result = await postMapOps({
          action: 'advance_one_key',
          targetLanguage,
          continuation,
        })
        lastResult = result
        applyMapOpsResult('一键推进地图队列', result)
        if (result.done || !result.continuation) break
        continuation = result.continuation
      }

      if (lastResult) {
        applyMapOpsResult('一键推进地图队列', lastResult, { running: false })
        if (lastResult.done) {
          toast.success(lastResult.message)
        } else {
          toast.info('一键推进已暂停，可继续执行')
        }
      }
      await reloadAll()
    } catch (error) {
      const message = normalizeFetchErrorMessage(error, '一键推进失败')
      setMapOpsMessage(message)
      patchMapOpsProgress({
        running: false,
        failed: 1,
        errors: [message],
        detail: message,
      })
      toast.error(message)
    } finally {
      setMapOpsLoading(false)
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
    try {
      await runSingleAction({
        title: '一键审核全部待审核',
        loadingDetail: '正在服务端批量审核 ready 任务...',
        body: {
          action: 'approve_all_ready',
          targetLanguage,
        },
        failFallback: '一键审核失败',
      })
    } finally {
      setApproveAllReadyRunning(false)
    }
  }

  async function approveMapSampleBatch() {
    const accepted = await askForConfirm({
      title: '确认抽检并批量发布',
      description: '将从 ready 地图任务中抽样并执行批量发布。',
      confirmLabel: '确认发布',
      cancelLabel: '取消',
    })
    if (!accepted) return

    setSampleApproving(true)
    try {
      await runSingleAction({
        title: '抽检并批量发布',
        loadingDetail: '正在服务端抽样发布地图任务...',
        body: {
          action: 'approve_sample',
          targetLanguage,
          sampleSize: 100,
        },
        failFallback: '抽检发布失败',
      })
    } finally {
      setSampleApproving(false)
    }
  }

  return {
    handleMapBackfill,
    handleMapIncrementalRefill,
    executeMapPendingBatch,
    executeMapFailedBatch,
    handleManualAdvanceMapQueue,
    handleOneKeyAdvanceMapQueue,
    approveAllReadyTasks,
    approveMapSampleBatch,
  }
}
