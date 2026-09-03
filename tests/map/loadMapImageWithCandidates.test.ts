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
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'

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

  it('loads user-uploaded point paths through the w=640&q=80 proxy candidates', async () => {
    const map = {
      loadImage: vi.fn(async (url: string): Promise<{ data: { url: string } }> => ({ data: { url } })),
    }

    const urls = getMapDisplayImageCandidates(
      'https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg',
      { kind: 'point' },
    )

    expect(urls.length).toBeGreaterThan(0)
    for (const candidate of urls) {
      // E2 双重编码：searchParams.get 解一层后再解一层等于目标
      const proxied = decodeURIComponent(new URL(candidate).searchParams.get('url') || '')
      expect(proxied).toBe('https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg?w=640&q=80')
      expect(proxied).not.toContain('plan=')
    }

    const result = await loadMapImageWithCandidates({
      map,
      slotKey: 'point-899-x',
      urls,
      tracked: false,
      directRequestTimeoutMs: 5,
      proxyRequestTimeoutMs: 5,
    })

    expect(result.finalUrl).toContain('/api/anitabi/image-render?url=')
    expect(map.loadImage).toHaveBeenCalledTimes(1)
    const requestedUrl = new URL(map.loadImage.mock.calls[0]?.[0] || '')
    expect(decodeURIComponent(requestedUrl.searchParams.get('url') || '')).toBe(
      'https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg?w=640&q=80',
    )
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

    // DEGRADED_HOST_FAILURE_THRESHOLD = 3：前两轮各累计 2 次直连失败（共 4 次），
    // 第三轮开始 host 已降级 → 代理候选提前。
    for (let round = 0; round < 2; round += 1) {
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
    }

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
        'warmup-first-view': 1,
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
        'warmup-first-view': 1,
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
      process.env[BREAKER_FLAG] = '1'
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 0)
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 1_000)
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 2_000)
      // 代理 URL 恒按上游标识记账（恒开）：此用例里代理上游与直连同为
      // image.anitabi.cn，共享降级状态。把先验失败滑出 10s blocked 窗口
      // （degraded TTL 60s 内仍降级），避免直连超时的第 4 次失败在窗口内
      // 累计到 blocked 阈值（6）连累代理候选被 fail-fast。
      vi.setSystemTime(20_000)

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
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 2_000)
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 4_000)
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 6_000)
      recordHostFailure('image.anitabi.cn', 'point-thumbnail', 8_000)
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

  describe('with proxy-aware host policy（恒开，无开关）', () => {
    it('attributes proxy-URL failures to the upstream host', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(1_000)
        process.env[BREAKER_FLAG] = '1'

        const proxyUrl = 'https://seichigo.com/api/anitabi/image-render?url=https%3A%2F%2Fimage.anitabi.cn%2Fpoints%2F1%2Fa.jpg%3Fplan%3Dh160'
        const map = {
          loadImage: vi.fn(async (): Promise<{ data: { url: string } }> => {
            return await new Promise(() => {})
          }),
        }

        // Three proxy failures (DEGRADED_HOST_FAILURE_THRESHOLD = 3): each records an
        // image.anitabi.cn failure via upstream attribution.
        const first = loadMapImageWithCandidates({
          map,
          slotKey: 'thumb-upstream-1',
          urls: [proxyUrl],
          tracked: false,
          hostPolicyScope: 'point-thumbnail',
          proxyRequestTimeoutMs: 1_000,
        })
        const firstAssertion = expect(first).rejects.toThrow()
        await vi.advanceTimersByTimeAsync(1_001)
        await firstAssertion

        vi.setSystemTime(2_000)
        const second = loadMapImageWithCandidates({
          map,
          slotKey: 'thumb-upstream-2',
          urls: [proxyUrl],
          tracked: false,
          hostPolicyScope: 'point-thumbnail',
          proxyRequestTimeoutMs: 1_000,
        })
        const secondAssertion = expect(second).rejects.toThrow()
        await vi.advanceTimersByTimeAsync(1_001)
        await secondAssertion

        vi.setSystemTime(3_000)
        const third = loadMapImageWithCandidates({
          map,
          slotKey: 'thumb-upstream-3',
          urls: [proxyUrl],
          tracked: false,
          hostPolicyScope: 'point-thumbnail',
          proxyRequestTimeoutMs: 1_000,
        })
        const thirdAssertion = expect(third).rejects.toThrow()
        await vi.advanceTimersByTimeAsync(1_001)
        await thirdAssertion

        // Fourth request: image.anitabi.cn should now be degraded → 2000ms clamp,
        // even though the request URL is a proxy URL.
        vi.setSystemTime(4_500)
        const fourth = loadMapImageWithCandidates({
          map,
          slotKey: 'thumb-upstream-4',
          urls: [proxyUrl],
          tracked: false,
          hostPolicyScope: 'point-thumbnail',
          proxyRequestTimeoutMs: 5_000,
        })
        const fourthAssertion = expect(fourth).rejects.toThrow()
        // 1999ms in: timeout should NOT have fired yet
        await vi.advanceTimersByTimeAsync(1_999)
        // 2001ms in: clamped 2000ms timeout fires (proves clamp engaged via upstream attribution)
        await vi.advanceTimersByTimeAsync(2)
        await fourthAssertion
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
