import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isBasemapFirstLoaded,
  markBasemapFirstLoaded,
  resetBasemapFirstLoadGateForTests,
  runAfterBasemapFirstLoad,
  waitForBasemapFirstLoad,
} from '@/features/map/anitabi/basemapFirstLoadGate'

describe('basemapFirstLoadGate', () => {
  beforeEach(() => {
    resetBasemapFirstLoadGateForTests()
  })

  afterEach(() => {
    resetBasemapFirstLoadGateForTests()
    vi.useRealTimers()
  })

  it('defers tasks until the basemap first load, then flushes in order', () => {
    const calls: string[] = []
    runAfterBasemapFirstLoad(() => calls.push('a'))
    runAfterBasemapFirstLoad(() => calls.push('b'))
    expect(calls).toEqual([])
    expect(isBasemapFirstLoaded()).toBe(false)

    markBasemapFirstLoaded()
    expect(calls).toEqual(['a', 'b'])
    expect(isBasemapFirstLoaded()).toBe(true)
  })

  it('runs tasks immediately once the basemap has loaded', () => {
    markBasemapFirstLoaded()
    const task = vi.fn()
    runAfterBasemapFirstLoad(task)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('markBasemapFirstLoaded is idempotent and flushes waiters only once', () => {
    const task = vi.fn()
    runAfterBasemapFirstLoad(task)
    markBasemapFirstLoaded()
    markBasemapFirstLoaded()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('keeps flushing remaining waiters when one waiter throws', () => {
    const calls: string[] = []
    runAfterBasemapFirstLoad(() => {
      throw new Error('boom')
    })
    runAfterBasemapFirstLoad(() => calls.push('after-throw'))
    markBasemapFirstLoaded()
    expect(calls).toEqual(['after-throw'])
  })

  it('waitForBasemapFirstLoad resolves true on load', async () => {
    const promise = waitForBasemapFirstLoad(5000)
    markBasemapFirstLoaded()
    await expect(promise).resolves.toBe(true)
  })

  it('waitForBasemapFirstLoad resolves false on timeout fallback', async () => {
    vi.useFakeTimers()
    const promise = waitForBasemapFirstLoad(2000)
    await vi.advanceTimersByTimeAsync(2100)
    await expect(promise).resolves.toBe(false)
    expect(isBasemapFirstLoaded()).toBe(false)
  })

  it('waitForBasemapFirstLoad resolves immediately when already loaded', async () => {
    markBasemapFirstLoaded()
    await expect(waitForBasemapFirstLoad(2000)).resolves.toBe(true)
  })
})
