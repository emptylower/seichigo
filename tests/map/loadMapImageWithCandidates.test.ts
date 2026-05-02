import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMapImageWithCandidates } from '@/components/map/utils/loadMapImageWithCandidates'
import {
  recordHostFailure,
  resetDegradedMapImageHostsForTest,
} from '@/components/map/utils/mapImageHostPolicy'
import {
  acquireMapImageRequestSlot,
  resetMapImageRequestSchedulerForTest,
} from '@/features/map/anitabi/mapImageRequestScheduler'

const BREAKER_FLAG = 'NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED'

describe('loadMapImageWithCandidates', () => {
  const originalBreakerFlag = process.env[BREAKER_FLAG]

  beforeEach(() => {
    resetDegradedMapImageHostsForTest()
    resetMapImageRequestSchedulerForTest()
    delete process.env[BREAKER_FLAG]
  })

  afterEach(() => {
    resetDegradedMapImageHostsForTest()
    if (originalBreakerFlag === undefined) {
      delete process.env[BREAKER_FLAG]
      return
    }
    process.env[BREAKER_FLAG] = originalBreakerFlag
  })

  it('promotes the proxy candidate earlier after the direct host degrades in-session', async () => {
    const map = {
      loadImage: vi.fn(async (url: string): Promise<{ data: { url: string } }> => {
        if (
          url === 'https://image.anitabi.cn/bangumi/290980.jpg'
          || url === 'https://image.anitabi.cn/bangumi/290980.jpg?_retry=1'
        ) {
          throw new Error('direct failed')
        }
        return { data: { url } }
      }),
    }

    await loadMapImageWithCandidates({
      map,
      slotKey: 'cover-290980',
      urls: [
        'https://image.anitabi.cn/bangumi/290980.jpg',
        'https://image.anitabi.cn/bangumi/290980.jpg?_retry=1',
        'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fbangumi%2F290980.jpg',
      ],
      tracked: false,
      directRequestTimeoutMs: 5,
      proxyRequestTimeoutMs: 5,
    })

    map.loadImage.mockClear()

    await loadMapImageWithCandidates({
      map,
      slotKey: 'cover-290980',
      urls: [
        'https://image.anitabi.cn/bangumi/290980.jpg',
        'https://image.anitabi.cn/bangumi/290980.jpg?_retry=1',
        'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fbangumi%2F290980.jpg',
      ],
      tracked: false,
      directRequestTimeoutMs: 5,
      proxyRequestTimeoutMs: 5,
    })

    expect(map.loadImage.mock.calls[0]?.[0]).toContain('/api/anitabi/image-render?url=')
  })

  it('waits for a shared viewport-visible slot before starting the map load', async () => {
    resetMapImageRequestSchedulerForTest({
      maxActive: 1,
      laneStartThresholds: {
        'interaction-critical': 1,
        'viewport-thumbnail': 1,
        'viewport-visible': 1,
        warmup: 1,
      },
    })

    const activeLease = await acquireMapImageRequestSlot({ lane: 'viewport-visible' })
    const map = {
      loadImage: vi.fn(async (url: string): Promise<{ data: { url: string } }> => ({ data: { url } })),
    }

    const pending = loadMapImageWithCandidates({
      map,
      slotKey: 'thumb-1',
      urls: ['https://image.anitabi.cn/points/1/a.jpg?plan=h160'],
      tracked: false,
      directRequestTimeoutMs: 5,
      proxyRequestTimeoutMs: 5,
    })

    await Promise.resolve()
    expect(map.loadImage).not.toHaveBeenCalled()

    activeLease.release()
    await pending

    expect(map.loadImage).toHaveBeenCalledTimes(1)
  })

  it('aborts a queued request before map.loadImage starts', async () => {
    resetMapImageRequestSchedulerForTest({
      maxActive: 1,
      laneStartThresholds: {
        'interaction-critical': 1,
        'viewport-thumbnail': 1,
        'viewport-visible': 1,
        warmup: 1,
      },
    })

    const activeLease = await acquireMapImageRequestSlot({ lane: 'viewport-visible' })
    const abortController = new AbortController()
    const map = {
      loadImage: vi.fn(async (url: string): Promise<{ data: { url: string } }> => ({ data: { url } })),
    }

    const pending = loadMapImageWithCandidates({
      map,
      slotKey: 'thumb-2',
      urls: ['https://image.anitabi.cn/points/2/b.jpg?plan=h160'],
      tracked: false,
      requestSignal: abortController.signal,
      directRequestTimeoutMs: 5,
      proxyRequestTimeoutMs: 5,
    })

    abortController.abort()
    activeLease.release()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(map.loadImage).not.toHaveBeenCalled()
  })

  it('keeps point-thumbnail host degradation separate from cover degradation', async () => {
    const map = {
      loadImage: vi.fn(async (url: string): Promise<{ data: { url: string } }> => {
        if (
          url === 'https://image.anitabi.cn/bangumi/290980.jpg'
          || url === 'https://image.anitabi.cn/bangumi/290980.jpg?_retry=1'
        ) {
          throw new Error('cover direct failed')
        }
        return { data: { url } }
      }),
    }

    await loadMapImageWithCandidates({
      map,
      slotKey: 'cover-290980',
      urls: [
        'https://image.anitabi.cn/bangumi/290980.jpg',
        'https://image.anitabi.cn/bangumi/290980.jpg?_retry=1',
        'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fbangumi%2F290980.jpg',
      ],
      tracked: false,
      hostPolicyScope: 'cover',
      directRequestTimeoutMs: 5,
      proxyRequestTimeoutMs: 5,
    })

    map.loadImage.mockClear()

    await loadMapImageWithCandidates({
      map,
      slotKey: 'thumb-290980',
      urls: [
        'https://image.anitabi.cn/points/290980/a.jpg?plan=h160',
        'https://image.anitabi.cn/points/290980/a.jpg?plan=h160&_retry=1',
        'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fpoints%2F290980%2Fa.jpg%3Fplan%3Dh160',
      ],
      tracked: false,
      hostPolicyScope: 'point-thumbnail',
      directRequestTimeoutMs: 5,
      proxyRequestTimeoutMs: 5,
    })

    expect(map.loadImage.mock.calls[0]?.[0]).toBe('https://image.anitabi.cn/points/290980/a.jpg?plan=h160')
  })

  it('requires repeated direct failures before proxy-first promotion kicks in', async () => {
    const map = {
      loadImage: vi.fn(async (url: string): Promise<{ data: { url: string } }> => {
        if (url === 'https://image.anitabi.cn/points/9/a.jpg?plan=h160') {
          throw new Error('direct failed once')
        }
        return { data: { url } }
      }),
    }

    await loadMapImageWithCandidates({
      map,
      slotKey: 'thumb-9',
      urls: [
        'https://image.anitabi.cn/points/9/a.jpg?plan=h160',
        'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fpoints%2F9%2Fa.jpg%3Fplan%3Dh160',
      ],
      tracked: false,
      hostPolicyScope: 'point-thumbnail',
      directRequestTimeoutMs: 5,
      proxyRequestTimeoutMs: 5,
    })

    map.loadImage.mockClear()

    await loadMapImageWithCandidates({
      map,
      slotKey: 'thumb-9',
      urls: [
        'https://image.anitabi.cn/points/9/a.jpg?plan=h160',
        'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fpoints%2F9%2Fa.jpg%3Fplan%3Dh160',
      ],
      tracked: false,
      hostPolicyScope: 'point-thumbnail',
      directRequestTimeoutMs: 5,
      proxyRequestTimeoutMs: 5,
    })

    expect(map.loadImage.mock.calls[0]?.[0]).toBe('https://image.anitabi.cn/points/9/a.jpg?plan=h160')
  })

  it('clamps degraded direct host timeouts to 2000ms when breaker v2 is enabled', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      process.env[BREAKER_FLAG] = '1'
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 0)
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 1_000)

      const map = {
        loadImage: vi.fn(async (url: string): Promise<{ data: { url: string } }> => {
          if (url === 'https://image.anitabi.cn/points/1/a.jpg?plan=h160') {
            return await new Promise(() => {})
          }
          return { data: { url } }
        }),
      }

      const pending = loadMapImageWithCandidates({
        map,
        slotKey: 'thumb-degraded',
        urls: [
          'https://image.anitabi.cn/points/1/a.jpg?plan=h160',
          'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fpoints%2F1%2Fa.jpg%3Fplan%3Dh160',
        ],
        tracked: false,
        hostPolicyScope: 'point-thumbnail',
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(map.loadImage).toHaveBeenCalledTimes(1)
      expect(map.loadImage.mock.calls[0]?.[0]).toBe('https://image.anitabi.cn/points/1/a.jpg?plan=h160')

      await vi.advanceTimersByTimeAsync(1_999)
      expect(map.loadImage).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      const result = await pending

      expect(map.loadImage).toHaveBeenCalledTimes(2)
      expect(result.finalUrl).toContain('/api/anitabi/image-render?url=')
    } finally {
      vi.useRealTimers()
    }
  })

  it('fail-fasts blocked direct hosts without calling map.loadImage when breaker v2 is enabled', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(9_999)
      process.env[BREAKER_FLAG] = '1'
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 0)
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 3_000)
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 9_999)

      const requestStart = vi.fn((input) => ({
        requestUrl: input.requestedCandidateUrl,
        requestId: 'req-0',
      }))
      const requestTerminal = vi.fn()
      const map = {
        loadImage: vi.fn(async (): Promise<{ data: { url: string } }> => {
          return await new Promise<{ data: { url: string } }>(() => {})
        }),
      }

      await expect(loadMapImageWithCandidates({
        map,
        slotKey: 'thumb-blocked',
        urls: ['https://image.anitabi.cn/points/2/b.jpg?plan=h160'],
        tracked: true,
        hostPolicyScope: 'point-thumbnail',
        onTrackedRequestStart: requestStart,
        onTrackedRequestTerminal: requestTerminal,
      })).rejects.toThrow('timeout')

      expect(map.loadImage).not.toHaveBeenCalled()
      expect(requestStart).toHaveBeenCalledTimes(1)
      expect(requestTerminal).toHaveBeenCalledWith({
        handle: {
          requestId: 'req-0',
          requestUrl: 'https://image.anitabi.cn/points/2/b.jpg?plan=h160',
        },
        terminalState: 'failed',
        finalUrl: 'https://image.anitabi.cn/points/2/b.jpg?plan=h160',
        chainTerminal: true,
        outcome: 'timeout',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
