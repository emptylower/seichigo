import { describe, expect, it, vi } from 'vitest'
import { CoverAvatarLoader } from '@/components/map/utils/coverAvatarLoader'

describe('CoverAvatarLoader', () => {
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
    let release: (() => void) | null = null
    const loadBlocked = new Promise<void>((resolve) => {
      release = resolve
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
    release?.()
    await Promise.all([p1, p2])

    expect(map.loadImage).toHaveBeenCalledTimes(1)
  })
})
