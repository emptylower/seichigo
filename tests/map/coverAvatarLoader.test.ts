import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CoverAvatarLoader } from '@/components/map/utils/coverAvatarLoader'
import { resetDegradedMapImageHostsForTest } from '@/components/map/utils/mapImageHostPolicy'
import { resetMapImageRequestSchedulerForTest } from '@/features/map/anitabi/mapImageRequestScheduler'

describe('CoverAvatarLoader', () => {
  beforeEach(() => {
    resetDegradedMapImageHostsForTest()
    resetMapImageRequestSchedulerForTest()
  })

  it('avoids immediate retry for failed covers', async () => {
    const map = {
      addImage: vi.fn(),
      removeImage: vi.fn(),
      hasImage: vi.fn(() => false),
      loadImage: vi.fn(async () => {
        throw new Error('load failed')
      }),
    }
    const loader = new CoverAvatarLoader({ map, maxLoaded: 16 })
    const candidates = [{ bangumiId: 513345, coverUrl: 'https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg' }]

    await loader.updateViewport(candidates)
    await loader.updateViewport(candidates)

    expect(map.loadImage).toHaveBeenCalledTimes(1)
  })

  it('caps candidate loading by maxLoaded', async () => {
    const map = {
      addImage: vi.fn(),
      removeImage: vi.fn(),
      hasImage: vi.fn(() => false),
      loadImage: vi.fn(async () => ({ data: { width: 16, height: 16 } })),
    }
    const loader = new CoverAvatarLoader({ map, maxLoaded: 2 })
    const candidates = [
      { bangumiId: 1, coverUrl: 'https://www.anitabi.cn/images/bangumi/1.jpg' },
      { bangumiId: 2, coverUrl: 'https://www.anitabi.cn/images/bangumi/2.jpg' },
      { bangumiId: 3, coverUrl: 'https://www.anitabi.cn/images/bangumi/3.jpg' },
    ]

    await loader.updateViewport(candidates)

    expect(map.loadImage).toHaveBeenCalledTimes(2)
  })

  it('deduplicates in-flight image loads across rapid updates', async () => {
    const releaseRef: { current: (() => void) | null } = { current: null }
    const loadBlocked = new Promise<void>((resolve) => {
      releaseRef.current = resolve
    })
    const map = {
      addImage: vi.fn(),
      removeImage: vi.fn(),
      hasImage: vi.fn(() => false),
      loadImage: vi.fn(async () => {
        await loadBlocked
        return { data: { width: 16, height: 16 } }
      }),
    }
    const loader = new CoverAvatarLoader({ map, maxLoaded: 16 })
    const candidates = [{ bangumiId: 1001, coverUrl: 'https://www.anitabi.cn/images/bangumi/1001.jpg' }]

    const p1 = loader.updateViewport(candidates)
    const p2 = loader.updateViewport(candidates)
    if (releaseRef.current) {
      releaseRef.current()
    }
    await Promise.all([p1, p2])

    expect(map.loadImage).toHaveBeenCalledTimes(1)
  })

  it('does not drop a replacement cover when the same bangumi switches urls during a rapid update', async () => {
    const releaseRef: { current: (() => void) | null } = { current: null }
    const loadBlocked = new Promise<void>((resolve) => {
      releaseRef.current = resolve
    })
    const map = {
      addImage: vi.fn(),
      removeImage: vi.fn(),
      hasImage: vi.fn(() => false),
      loadImage: vi.fn(async (url: string) => {
        if (url.includes('/1001-a.jpg')) {
          await loadBlocked
        }
        return { data: { width: 16, height: 16, url } }
      }),
    }
    const loader = new CoverAvatarLoader({ map, maxLoaded: 16 })

    const first = loader.updateViewport([
      { bangumiId: 1001, coverUrl: 'https://www.anitabi.cn/images/bangumi/1001-a.jpg' },
    ])
    await Promise.resolve()

    const second = loader.updateViewport([
      { bangumiId: 1001, coverUrl: 'https://www.anitabi.cn/images/bangumi/1001-b.jpg' },
    ])

    if (releaseRef.current) {
      releaseRef.current()
    }

    const secondResult = await second
    await first

    expect(secondResult.has('cover-1001')).toBe(true)
    expect(map.loadImage.mock.calls.some((call) => String(call[0]).includes('/1001-b.jpg'))).toBe(true)
  })

  it('rewrites bangumi large cover urls to smaller variants before loading', async () => {
    const map = {
      addImage: vi.fn(),
      removeImage: vi.fn(),
      hasImage: vi.fn(() => false),
      loadImage: vi.fn(async () => ({ data: { width: 16, height: 16 } })),
    }
    const loader = new CoverAvatarLoader({ map, maxLoaded: 16 })
    const candidates = [{ bangumiId: 513345, coverUrl: 'https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg' }]

    await loader.updateViewport(candidates)

    expect(map.loadImage).toHaveBeenCalledTimes(1)
    const firstLoadCall = map.loadImage.mock.calls.at(0) as any[] | undefined
    expect(decodeURIComponent(String(firstLoadCall?.[0] || ''))).toContain('/pic/cover/m/')
  })

  it('retries failed covers again after cooldown expires', async () => {
    let currentTime = 0
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentTime)
    const map = {
      addImage: vi.fn(),
      removeImage: vi.fn(),
      hasImage: vi.fn(() => false),
      loadImage: vi.fn(async () => {
        throw new Error('load failed')
      }),
    }
    const loader = new CoverAvatarLoader({ map, maxLoaded: 16 })
    const candidates = [{ bangumiId: 513345, coverUrl: 'https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg' }]

    await loader.updateViewport(candidates)
    currentTime = 4000
    await loader.updateViewport(candidates)
    expect(map.loadImage).toHaveBeenCalledTimes(1)

    currentTime = 9000
    await loader.updateViewport(candidates)
    expect(map.loadImage).toHaveBeenCalledTimes(2)

    nowSpy.mockRestore()
  })

  it('emits tracked first-view callbacks for visible cover slots', async () => {
    const requestStart = vi.fn()
    const terminal = vi.fn()
    const map = {
      addImage: vi.fn(),
      removeImage: vi.fn(),
      hasImage: vi.fn(() => false),
      loadImage: vi.fn(async () => ({ data: { width: 16, height: 16 } })),
    }
    const loader = new CoverAvatarLoader({
      map,
      maxLoaded: 16,
      firstViewTrackedLimit: 1,
      onTrackedRequestStart: (input) => {
        requestStart(input)
        return { requestUrl: input.requestedCandidateUrl, requestId: `${input.slotKey}:${input.candidateIndex}` }
      },
      onTrackedRequestTerminal: terminal,
    })

    await loader.updateViewport([
      { bangumiId: 513345, coverUrl: 'https://lain.bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg' },
      { bangumiId: 513346, coverUrl: 'https://lain.bgm.tv/pic/cover/l/b8/0d/513346_jv4wM.jpg' },
    ])

    expect(requestStart).toHaveBeenCalledTimes(1)
    const firstRequestStartCall = requestStart.mock.calls.at(0) as any[] | undefined
    expect(firstRequestStartCall?.[0]).toMatchObject({
      slotKey: 'cover-513345',
    })
    expect(terminal).toHaveBeenCalledTimes(1)
    const firstTerminalCall = terminal.mock.calls.at(0) as any[] | undefined
    expect(firstTerminalCall?.[0]).toMatchObject({
      handle: { requestId: 'cover-513345:0' },
      terminalState: 'succeeded',
    })
  })

  it('falls back to proxy when direct anitabi bangumi cover loading fails', async () => {
    const map = {
      addImage: vi.fn(),
      removeImage: vi.fn(),
      hasImage: vi.fn(() => false),
      loadImage: vi.fn(async (url: string) => {
        if (url === 'https://image.anitabi.cn/bangumi/290980.jpg' || url === 'https://image.anitabi.cn/bangumi/290980.jpg?_retry=1') {
          throw new Error('direct failed')
        }
        return { data: { width: 16, height: 16, url } }
      }),
    }
    const loader = new CoverAvatarLoader({ map, maxLoaded: 16 })

    await loader.updateViewport([{ bangumiId: 290980, coverUrl: 'https://www.anitabi.cn/bangumi/290980.jpg' }])

    expect(map.loadImage).toHaveBeenCalledTimes(3)
    const loadCalls = map.loadImage.mock.calls as any[][]
    expect(loadCalls[0]?.[0]).toBe('https://image.anitabi.cn/bangumi/290980.jpg')
    expect(loadCalls[1]?.[0]).toBe('https://image.anitabi.cn/bangumi/290980.jpg?_retry=1')
    expect(decodeURIComponent(String(loadCalls[2]?.[0] || ''))).toContain('/api/anitabi/image-render?url=https://image.anitabi.cn/bangumi/290980.jpg')
  })

  it('bounds local waiting and advances to the next candidate when a cover request stalls', async () => {
    const map = {
      addImage: vi.fn(),
      removeImage: vi.fn(),
      hasImage: vi.fn(() => false),
      loadImage: vi.fn(async (url: string): Promise<{ data: { width: number; height: number; url: string } }> => {
        if (url === 'https://image.anitabi.cn/bangumi/290980.jpg') {
          return await new Promise(() => {})
        }
        return { data: { width: 16, height: 16, url } }
      }),
    }
    const loader = new CoverAvatarLoader({
      map,
      maxLoaded: 16,
      directRequestTimeoutMs: 5,
      proxyRequestTimeoutMs: 5,
    })

    await loader.updateViewport([{ bangumiId: 290980, coverUrl: 'https://www.anitabi.cn/bangumi/290980.jpg' }])

    expect(map.loadImage).toHaveBeenCalledTimes(2)
    expect(map.loadImage.mock.calls[1]?.[0]).toBe('https://image.anitabi.cn/bangumi/290980.jpg?_retry=1')
  })
})
