import { useCallback } from 'react'
import { WARMUP_TASK_WEIGHTS } from './shared'
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

  const computeWarmupPercent = useCallback((tasks: WarmupTaskProgress): number => {
    let weightedSum = 0
    let totalWeight = 0
    let allDone = true
    for (const key of Object.keys(tasks) as WarmupTaskKey[]) {
      const weight = WARMUP_TASK_WEIGHTS[key]
      const taskPercent = Math.max(0, Math.min(100, tasks[key].percent))
      if (taskPercent < 100) allDone = false
      weightedSum += taskPercent * weight
      totalWeight += weight
    }
    if (!totalWeight) return 0
    const raw = weightedSum / totalWeight
    if (allDone) return 100
    return Math.max(0, Math.min(99, Math.floor(raw)))
  }, [])

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
        detail: next.detail ?? prevWarmup.detail,
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
