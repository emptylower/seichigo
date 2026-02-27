import { describe, expect, it, vi } from 'vitest'
import { createProgressTracker } from '@/lib/anitabi/client/progressTracker'

describe('progressTracker', () => {
  it('initializes with idle state', () => {
    const tracker = createProgressTracker()
    const progress = tracker.getProgress()

    expect(progress.phase).toBe('idle')
    expect(progress.loaded).toBe(0)
    expect(progress.total).toBeNull()
    expect(progress.percent).toBe(0)
  })

  it('updates loaded and total, calculates percent', () => {
    const tracker = createProgressTracker()
    tracker.update(50, 100)

    const progress = tracker.getProgress()
    expect(progress.loaded).toBe(50)
    expect(progress.total).toBe(100)
    expect(progress.percent).toBe(50)
  })

  it('calculates percent correctly for different values', () => {
    const tracker = createProgressTracker()

    tracker.update(25, 100)
    expect(tracker.getProgress().percent).toBe(25)

    tracker.update(75, 100)
    expect(tracker.getProgress().percent).toBe(75)

    tracker.update(100, 100)
    expect(tracker.getProgress().percent).toBe(100)
  })

  it('handles null total with time-based estimation', () => {
    const tracker = createProgressTracker()
    tracker.setPhase('loading')
    tracker.update(50, null)

    const progress = tracker.getProgress()
    expect(progress.loaded).toBe(50)
    expect(progress.total).toBeNull()
    expect(progress.percent).toBeGreaterThanOrEqual(0)
  })

  it('setPhase changes phase', () => {
    const tracker = createProgressTracker()

    tracker.setPhase('loading')
    expect(tracker.getProgress().phase).toBe('loading')

    tracker.setPhase('done')
    expect(tracker.getProgress().phase).toBe('done')
  })

  it('setPhase to done sets percent to 100', () => {
    const tracker = createProgressTracker()
    tracker.update(50, 100)

    tracker.setPhase('done')
    const progress = tracker.getProgress()
    expect(progress.phase).toBe('done')
    expect(progress.percent).toBe(100)
  })

  it('reset returns to idle state', () => {
    const tracker = createProgressTracker()
    tracker.setPhase('loading')
    tracker.update(50, 100)

    tracker.reset()
    const progress = tracker.getProgress()
    expect(progress.phase).toBe('idle')
    expect(progress.loaded).toBe(0)
    expect(progress.total).toBeNull()
    expect(progress.percent).toBe(0)
  })

  it('callback fires on update', () => {
    const tracker = createProgressTracker()
    const callback = vi.fn()

    tracker.onProgress(callback)
    tracker.update(50, 100)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      phase: 'idle',
      loaded: 50,
      total: 100,
      percent: 50
    })
  })

  it('callback fires on setPhase', () => {
    const tracker = createProgressTracker()
    const callback = vi.fn()

    tracker.onProgress(callback)
    tracker.setPhase('loading')

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      phase: 'loading',
      loaded: 0,
      total: null,
      percent: 0
    })
  })

  it('callback fires on reset', () => {
    const tracker = createProgressTracker()
    const callback = vi.fn()

    tracker.update(50, 100)
    tracker.onProgress(callback)
    tracker.reset()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      phase: 'idle',
      loaded: 0,
      total: null,
      percent: 0
    })
  })

  it('multiple callbacks fire on update', () => {
    const tracker = createProgressTracker()
    const callback1 = vi.fn()
    const callback2 = vi.fn()

    tracker.onProgress(callback1)
    tracker.onProgress(callback2)
    tracker.update(50, 100)

    expect(callback1).toHaveBeenCalledTimes(1)
    expect(callback2).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops callbacks', () => {
    const tracker = createProgressTracker()
    const callback = vi.fn()

    const unsubscribe = tracker.onProgress(callback)
    tracker.update(25, 100)
    expect(callback).toHaveBeenCalledTimes(1)

    unsubscribe()
    tracker.update(50, 100)
    expect(callback).toHaveBeenCalledTimes(1) // Still 1, not called again
  })

  it('unsubscribe one callback does not affect others', () => {
    const tracker = createProgressTracker()
    const callback1 = vi.fn()
    const callback2 = vi.fn()

    const unsubscribe1 = tracker.onProgress(callback1)
    tracker.onProgress(callback2)

    tracker.update(25, 100)
    expect(callback1).toHaveBeenCalledTimes(1)
    expect(callback2).toHaveBeenCalledTimes(1)

    unsubscribe1()
    tracker.update(50, 100)
    expect(callback1).toHaveBeenCalledTimes(1) // Not called again
    expect(callback2).toHaveBeenCalledTimes(2) // Called again
  })

  it('getProgress returns a copy of state', () => {
    const tracker = createProgressTracker()
    tracker.update(50, 100)

    const progress1 = tracker.getProgress()
    const progress2 = tracker.getProgress()

    expect(progress1).toEqual(progress2)
    expect(progress1).not.toBe(progress2) // Different objects
  })
})
