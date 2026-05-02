import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMapImageWithCandidates } from '@/components/map/utils/loadMapImageWithCandidates'
import { resetDegradedMapImageHostsForTest } from '@/components/map/utils/mapImageHostPolicy'
import {
  acquireMapImageRequestSlot,
  resetMapImageRequestSchedulerForTest,
} from '@/features/map/anitabi/mapImageRequestScheduler'

describe('loadMapImageWithCandidates', () => {
  beforeEach(() => {
    resetDegradedMapImageHostsForTest()
    resetMapImageRequestSchedulerForTest()
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
})
