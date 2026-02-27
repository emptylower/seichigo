import type { LoadProgress } from './types'

type ProgressCallback = (progress: LoadProgress) => void

export type ProgressTracker = {
  getProgress(): LoadProgress
  onProgress(callback: ProgressCallback): () => void
  update(loaded: number, total: number | null): void
  setPhase(phase: LoadProgress['phase']): void
  reset(): void
}

export function createProgressTracker(): ProgressTracker {
  let state: LoadProgress = {
    phase: 'idle',
    loaded: 0,
    total: null,
    percent: 0
  }

  const callbacks = new Set<ProgressCallback>()
  let startTime: number | null = null

  const notify = () => {
    callbacks.forEach(cb => cb(state))
  }

  const calculatePercent = (loaded: number, total: number | null): number => {
    if (total !== null && total > 0) {
      return Math.round((loaded / total) * 100)
    }

    // Fallback: estimate based on time elapsed (asymptotic approach to 90%)
    if (startTime !== null) {
      const elapsed = Date.now() - startTime
      const estimatedPercent = Math.min(90, Math.round((elapsed / 10000) * 90))
      return estimatedPercent
    }

    return 0
  }

  return {
    getProgress() {
      return { ...state }
    },

    onProgress(callback: ProgressCallback) {
      callbacks.add(callback)
      return () => {
        callbacks.delete(callback)
      }
    },

    update(loaded: number, total: number | null) {
      state = {
        ...state,
        loaded,
        total,
        percent: calculatePercent(loaded, total)
      }
      notify()
    },

    setPhase(phase: LoadProgress['phase']) {
      if (phase === 'loading' && startTime === null) {
        startTime = Date.now()
      } else if (phase === 'idle' || phase === 'done') {
        startTime = null
      }

      state = {
        ...state,
        phase,
        percent: phase === 'done' ? 100 : state.percent
      }
      notify()
    },

    reset() {
      state = {
        phase: 'idle',
        loaded: 0,
        total: null,
        percent: 0
      }
      startTime = null
      notify()
    }
  }
}
