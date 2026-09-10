import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetCoverSpriteSharedStateForTests,
  createCoverSpriteSource,
} from '@/components/map/utils/coverSpriteSource'

const validAtlas = {
  version: 'a1b2c3d4e5f6',
  tile: 4,
  grid: [2, 1],
  count: 2,
  icons: { '101': [0, 0], '202': [1, 0] },
}

/** jsdom 不加载真实图片：src 赋值即触发 onload（合法版本号）/onerror。 */
function stubSheetImage(ok = true): void {
  class FakeImage {
    naturalWidth = 8
    naturalHeight = 4
    width = 8
    height = 4
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    private _src = ''
    set src(value: string) {
      this._src = value
      queueMicrotask(() => {
        if (ok) this.onload?.()
        else this.onerror?.()
      })
    }
    get src(): string {
      return this._src
    }
  }
  vi.stubGlobal('Image', FakeImage)
}

function installCanvasShim(): void {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ width: 4, height: 4, data: new Uint8ClampedArray(16) })),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
  }
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement
    return document.createElement(tag)
  })
}

describe('createCoverSpriteSource', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    __resetCoverSpriteSharedStateForTests()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubAtlasResponse(ok: boolean, body?: unknown) {
    fetchMock.mockImplementation(async () =>
      new Response(ok ? JSON.stringify(body ?? validAtlas) : '{}', {
        status: ok ? 200 : 404,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }

  it('slices tiles for bangumi ids present in the atlas (1 atlas request, sheet via Image)', async () => {
    stubAtlasResponse(true)
    stubSheetImage(true)
    installCanvasShim()

    const tiles = await createCoverSpriteSource().loadTiles([101, 202, 303])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/anitabi/sprite')
    expect(tiles.has(101)).toBe(true)
    expect(tiles.has(202)).toBe(true)
    expect(tiles.has(303)).toBe(false) // 不在 atlas → 回落旧路径
  })

  it('returns an empty map on atlas 404 (fallback path)', async () => {
    stubAtlasResponse(false)

    const tiles = await createCoverSpriteSource().loadTiles([101])

    expect(tiles.size).toBe(0)
  })

  it('returns an empty map for invalid atlas payloads', async () => {
    stubAtlasResponse(true, { version: 'bad', tile: 0, grid: [0, 0], icons: {} })

    const tiles = await createCoverSpriteSource().loadTiles([101])

    expect(tiles.size).toBe(0)
  })

  it('returns an empty map when the sheet image fails to load', async () => {
    stubAtlasResponse(true)
    stubSheetImage(false)
    installCanvasShim()

    const tiles = await createCoverSpriteSource().loadTiles([101])

    expect(tiles.size).toBe(0)
  })

  it('negative-caches failures so repeated viewports do not re-fetch', async () => {
    stubAtlasResponse(false)

    const source = createCoverSpriteSource()
    await source.loadTiles([101])
    await source.loadTiles([101])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses the cached atlas and sheet across loads within the TTL', async () => {
    stubAtlasResponse(true)
    stubSheetImage(true)
    installCanvasShim()

    const source = createCoverSpriteSource()
    await source.loadTiles([101])
    await source.loadTiles([101, 202])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('handles slice failures gracefully (getImageData throws → tile dropped)', async () => {
    stubAtlasResponse(true)
    stubSheetImage(true)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: vi.fn(),
            getImageData: () => {
              throw new Error('tainted canvas')
            },
          }),
        } as unknown as HTMLCanvasElement
      }
      return document.createElement(tag)
    })

    const tiles = await createCoverSpriteSource().loadTiles([101])

    expect(tiles.size).toBe(0)
  })
})
