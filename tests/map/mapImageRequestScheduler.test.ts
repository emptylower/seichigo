import { beforeEach, describe, expect, it } from 'vitest'
import {
  acquireMapImageRequestSlot,
  readMapImageRequestSchedulerSnapshotForTest,
  resetMapImageRequestSchedulerForTest,
} from '@/features/map/anitabi/mapImageRequestScheduler'

describe('mapImageRequestScheduler', () => {
  beforeEach(() => {
    resetMapImageRequestSchedulerForTest({
      maxActive: 2,
      laneStartThresholds: {
        'interaction-critical': 2,
        'viewport-thumbnail': 2,
        'viewport-visible': 1,
        'warmup-first-view': 1,
        warmup: 1,
      },
    })
  })

  it('keeps headroom for interaction-critical work when viewport-visible is active', async () => {
    const viewportLease = await acquireMapImageRequestSlot({ lane: 'viewport-visible' })
    const interactionLease = await acquireMapImageRequestSlot({ lane: 'interaction-critical' })

    expect(readMapImageRequestSchedulerSnapshotForTest()).toMatchObject({
      activeTotal: 2,
      activeByLane: {
        'interaction-critical': 1,
        'viewport-thumbnail': 0,
        'viewport-visible': 1,
        'warmup-first-view': 0,
        warmup: 0,
      },
    })

    interactionLease.release()
    viewportLease.release()
  })

  it('serves queued interaction-critical work before lower-priority warmup work', async () => {
    resetMapImageRequestSchedulerForTest({
      maxActive: 1,
      laneStartThresholds: {
        'interaction-critical': 1,
        'viewport-thumbnail': 1,
        'viewport-visible': 1,
        'warmup-first-view': 1,
        warmup: 1,
      },
    })

    const activeWarmupLease = await acquireMapImageRequestSlot({ lane: 'warmup' })
    const startOrder: string[] = []

    const nextWarmup = acquireMapImageRequestSlot({ lane: 'warmup' }).then((lease) => {
      startOrder.push('warmup')
      return lease
    })
    const nextInteraction = acquireMapImageRequestSlot({ lane: 'interaction-critical' }).then((lease) => {
      startOrder.push('interaction')
      return lease
    })

    activeWarmupLease.release()

    const interactionLease = await nextInteraction
    expect(startOrder).toEqual(['interaction'])
    interactionLease.release()

    const warmupLease = await nextWarmup
    expect(startOrder).toEqual(['interaction', 'warmup'])
    warmupLease.release()
  })

  it('drops aborted queued requests instead of blocking the queue', async () => {
    resetMapImageRequestSchedulerForTest({
      maxActive: 1,
      laneStartThresholds: {
        'interaction-critical': 1,
        'viewport-thumbnail': 1,
        'viewport-visible': 1,
        'warmup-first-view': 1,
        warmup: 1,
      },
    })

    const activeWarmupLease = await acquireMapImageRequestSlot({ lane: 'warmup' })
    const abortController = new AbortController()
    const queued = acquireMapImageRequestSlot({
      lane: 'warmup',
      signal: abortController.signal,
    })
    abortController.abort()

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(readMapImageRequestSchedulerSnapshotForTest().queuedByLane.warmup).toBe(0)

    activeWarmupLease.release()
  })

  it('treats warmup thresholds as total-active headroom, not per-lane caps', async () => {
    resetMapImageRequestSchedulerForTest({
      maxActive: 3,
      laneStartThresholds: {
        'interaction-critical': 3,
        'viewport-thumbnail': 2,
        'viewport-visible': 2,
        'warmup-first-view': 2,
        warmup: 1,
      },
    })

    const interactionLease = await acquireMapImageRequestSlot({ lane: 'interaction-critical' })
    const queuedWarmup = acquireMapImageRequestSlot({ lane: 'warmup' })

    await Promise.resolve()
    expect(readMapImageRequestSchedulerSnapshotForTest()).toMatchObject({
      activeTotal: 1,
      queuedByLane: { warmup: 1 },
      laneStartThresholds: { warmup: 1 },
    })

    interactionLease.release()
    const warmupLease = await queuedWarmup
    warmupLease.release()
  })

  it('serves queued viewport-thumbnail work before lower-priority viewport-visible work', async () => {
    resetMapImageRequestSchedulerForTest({
      maxActive: 2,
      laneStartThresholds: {
        'interaction-critical': 2,
        'viewport-thumbnail': 2,
        'viewport-visible': 1,
        'warmup-first-view': 1,
        warmup: 1,
      },
    })

    const blockingLease = await acquireMapImageRequestSlot({ lane: 'warmup' })
    const startOrder: string[] = []

    const nextVisible = acquireMapImageRequestSlot({ lane: 'viewport-visible' }).then((lease) => {
      startOrder.push('visible')
      return lease
    })
    const nextThumbnail = acquireMapImageRequestSlot({ lane: 'viewport-thumbnail' }).then((lease) => {
      startOrder.push('thumbnail')
      return lease
    })

    blockingLease.release()

    const thumbnailLease = await nextThumbnail
    expect(startOrder).toEqual(['thumbnail'])
    thumbnailLease.release()

    const visibleLease = await nextVisible
    expect(startOrder).toEqual(['thumbnail', 'visible'])
    visibleLease.release()
  })
})
