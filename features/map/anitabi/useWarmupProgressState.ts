import { useCallback } from 'react'
import { WARMUP_TASK_WEIGHTS, computeWeightedWarmupPercent } from './shared'
import type { WarmupProgress, WarmupTaskKey, WarmupTaskProgress } from './shared'

export function useWarmupProgressState(ctx: any) {
  const {
    label,
    setWarmupProgress,
    setWarmupTaskProgress,
    warmupBlockingUiRef,
    warmupMetricRef,
    warmupRunTokenRef,
  } = ctx

  const updateWarmupProgress = useCallback((next: Partial<WarmupProgress>, options?: { runToken?: number }) => {
    const runToken = options?.runToken
    if (runToken != null && runToken !== warmupRunTokenRef.current) return
    setWarmupProgress((prev: WarmupProgress) => ({
      phase: next.phase || prev.phase,
      percent: Math.max(0, Math.min(100, next.percent ?? prev.percent)),
      title: next.title || label.preloadTitle,
      detail: next.detail ?? prev.detail,
    }))
  }, [label.preloadTitle, setWarmupProgress, warmupRunTokenRef])

  // 内部口径：四任务加权聚合，仅用于 warmupMetricRef 记录与上报（对外可见进度的
  // map+cards 口径在 useAnitabiMapController 里用 WARMUP_VISIBLE_TASK_WEIGHTS 另行派生）。
  const computeWarmupPercent = useCallback(
    (tasks: WarmupTaskProgress): number => computeWeightedWarmupPercent(tasks, WARMUP_TASK_WEIGHTS),
    [],
  )

  const resetWarmupTaskProgress = useCallback(() => {
    setWarmupTaskProgress({
      map: { percent: 0, detail: '' },
      cards: { percent: 0, detail: '' },
      details: { percent: 0, detail: '' },
      images: { percent: 0, detail: '' },
    })
  }, [setWarmupTaskProgress])

  const updateWarmupTask = useCallback((
    key: WarmupTaskKey,
    next: { percent?: number; detail?: string },
    options?: { runToken?: number },
  ) => {
    const runToken = options?.runToken
    if (runToken != null && runToken !== warmupRunTokenRef.current) return
    setWarmupTaskProgress((prev: WarmupTaskProgress) => {
      const current = prev[key]
      const incomingPercent = Math.max(0, Math.min(100, next.percent ?? current.percent))
      const nextPercent = incomingPercent < current.percent ? current.percent : incomingPercent
      if (incomingPercent < current.percent) {
        const blocked = Number(warmupMetricRef.current.progress_regression_blocked || 0)
        warmupMetricRef.current.progress_regression_blocked = blocked + 1
      }
      const merged: WarmupTaskProgress = {
        ...prev,
        [key]: {
          percent: nextPercent,
          detail: incomingPercent < current.percent ? current.detail : (next.detail ?? current.detail),
        },
      }
      const combinedPercent = computeWarmupPercent(merged)
      // 内部指标口径不变：四任务的细粒度文本（含点位分块/图片预热）照常记录，
      // 供服务端与日志排查。
      warmupMetricRef.current.last_progress_at = Date.now()
      warmupMetricRef.current.last_progress_key = key
      warmupMetricRef.current.last_progress_percent = combinedPercent
      warmupMetricRef.current.last_progress_detail = next.detail ?? current.detail
      setWarmupProgress((prevWarmup: WarmupProgress) => ({
        phase: prevWarmup.phase === 'idle' && warmupBlockingUiRef.current && combinedPercent < 100
          ? 'loading'
          : prevWarmup.phase,
        percent: combinedPercent,
        title: label.preloadTitle,
        // 卡片说明文字只由 map/cards 两个「地图可用」任务驱动；details/images
        // 在后台预热，其 detail 文本不再进入可见卡片（内部指标见上方）。
        detail: key === 'map' || key === 'cards' ? (next.detail ?? prevWarmup.detail) : prevWarmup.detail,
      }))
      return merged
    })
  }, [computeWarmupPercent, label.preloadTitle, setWarmupProgress, setWarmupTaskProgress, warmupBlockingUiRef, warmupMetricRef, warmupRunTokenRef])

  const completeAllWarmupTasks = useCallback((options?: { runToken?: number }) => {
    const runToken = options?.runToken
    if (runToken != null && runToken !== warmupRunTokenRef.current) return
    setWarmupTaskProgress((prev: WarmupTaskProgress) => ({
      map: { percent: 100, detail: prev.map.detail || label.preloadMapDone },
      cards: { percent: 100, detail: prev.cards.detail },
      details: { percent: 100, detail: prev.details.detail },
      images: { percent: 100, detail: prev.images.detail },
    }))
  }, [label.preloadMapDone, setWarmupTaskProgress, warmupRunTokenRef])

  return {
    completeAllWarmupTasks,
    resetWarmupTaskProgress,
    updateWarmupProgress,
    updateWarmupTask,
  }
}
