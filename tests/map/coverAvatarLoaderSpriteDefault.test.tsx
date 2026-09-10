import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoverAvatarLoader } from '@/components/map/utils/coverAvatarLoader'
import { __resetCoverSpriteSharedStateForTests } from '@/components/map/utils/coverSpriteSource'
import { resetDegradedMapImageHostsForTest } from '@/components/map/utils/mapImageHostPolicy'
import { resetMapImageRequestSchedulerForTest } from '@/features/map/anitabi/mapImageRequestScheduler'

/**
 * 2026-09-10：sprite 快路径默认关闭（见 coverAvatarLoader 构造函数处的盈亏
 * 测算注释，盈亏平衡点 ≈306 个不同封面）。本套件在 jsdom（有 document/fetch，
 * sprite 切片前提成立）下钉死默认行为：默认构造的 loader 不得发出
 * `/api/anitabi/sprite` 与 `/api/anitabi/sprite/sheet` 请求，全员走候选梯。
 * 重新启用默认的前提是 coverSpriteSource 先实现分片。
 */
describe('CoverAvatarLoader sprite default (jsdom)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let imageSrcSet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    __resetCoverSpriteSharedStateForTests()
    resetDegradedMapImageHostsForTest()
    resetMapImageRequestSchedulerForTest()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    imageSrcSet = vi.fn()
    // sheet 走 `new Image().src = ...`；挂 setter 监听，若默认路径偷偷灌表会留痕。
    class FakeImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(value: string) {
        imageSrcSet(value)
        queueMicrotask(() => this.onerror?.())
      }
    }
    vi.stubGlobal('Image', FakeImage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not request the sprite atlas/sheet on the default path (jsdom)', async () => {
    const map = {
      addImage: vi.fn(),
      removeImage: vi.fn(),
      hasImage: vi.fn(() => false),
      loadImage: vi.fn(async (url: string) => ({ data: { width: 16, height: 16, url } })),
    }
    // 不传 spriteSource：默认必须关闭
    const loader = new CoverAvatarLoader({ map, maxLoaded: 16 })

    const loaded = await loader.updateViewport([
      { bangumiId: 290980, coverUrl: 'https://www.anitabi.cn/bangumi/290980.jpg' },
    ])

    const spriteFetches = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/api/anitabi/sprite'))
    const spriteSheetLoads = imageSrcSet.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/api/anitabi/sprite'))
    expect(spriteFetches).toEqual([])
    expect(spriteSheetLoads).toEqual([])

    // 候选梯照常工作：逐张加载并把封面放进 lru
    expect(map.loadImage).toHaveBeenCalledTimes(1)
    expect(loaded.has('cover-290980')).toBe(true)
  })
})
