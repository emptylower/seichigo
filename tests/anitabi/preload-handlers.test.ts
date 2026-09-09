import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { createHandlers as createManifestHandlers } from '@/lib/anitabi/handlers/preloadManifest'
import { createHandlers as createChunkHandlers } from '@/lib/anitabi/handlers/preloadChunks'
import type { PreloadCacheStore } from '@/lib/anitabi/preloadEdgeCache'

const mocks = vi.hoisted(() => ({
  getPreloadManifest: vi.fn(),
  listPreloadChunk: vi.fn(),
}))

vi.mock('@/lib/anitabi/read', () => ({
  getPreloadManifest: mocks.getPreloadManifest,
  listPreloadChunk: mocks.listPreloadChunk,
}))

function createDeps(overrides: Partial<AnitabiApiDeps> = {}): AnitabiApiDeps {
  return {
    prisma: {} as never,
    getSession: async () => null,
    now: () => new Date(),
    getCronSecret: () => '',
    getApiBase: () => 'https://api.anitabi.cn',
    getSiteBase: () => 'https://www.anitabi.cn',
    ...overrides,
  }
}

/** 最小可用的 Cache API 替身：按 key 保存 Response 副本。 */
function createMemoryCacheStore(): PreloadCacheStore & {
  entries: Map<string, Response>
  putSpy: ReturnType<typeof vi.fn>
} {
  const entries = new Map<string, Response>()
  const store: PreloadCacheStore = {
    async match(request) {
      const hit = entries.get(request.url)
      if (!hit) return undefined
      return new Response(await hit.clone().arrayBuffer(), hit)
    },
    async put(request, response) {
      entries.set(request.url, response.clone())
    },
  }
  const putSpy = vi.fn(store.put.bind(store))
  store.put = putSpy as unknown as PreloadCacheStore['put']
  return { ...store, entries, putSpy }
}

describe('anitabi preload handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('manifest handler returns preload manifest with cache headers', async () => {
    mocks.getPreloadManifest.mockResolvedValue({
      datasetVersion: 'v1',
      modifiedMs: 1,
      chunkSize: 200,
      chunkCount: 1,
      tabs: { nearby: [], latest: [], recent: [], hot: [] },
    })
    const deps = createDeps()
    const res = await createManifestHandlers(deps).GET(new Request('http://localhost/api/anitabi/preload/manifest?locale=zh'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.datasetVersion).toBe('v1')
    expect(mocks.getPreloadManifest).toHaveBeenCalledTimes(1)
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=300, stale-while-revalidate=1800')
  })

  it('chunk handler returns chunk payload with cache headers', async () => {
    mocks.listPreloadChunk.mockResolvedValue({
      datasetVersion: 'v2',
      index: 3,
      items: [{
        bangumiId: 99,
        modifiedMs: 10,
        points: [],
        theme: null,
      }],
    })
    const deps = createDeps()
    const res = await createChunkHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/preload/chunks/3?locale=ja'),
      { index: '3' },
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.index).toBe(3)
    expect(json.datasetVersion).toBe('v2')
    expect(mocks.listPreloadChunk).toHaveBeenCalledTimes(1)
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=300, stale-while-revalidate=1800')
  })

  it('chunk data payload is byte-identical across cache miss and hit (content lock)', async () => {
    const payload = {
      datasetVersion: 'v2',
      index: 0,
      items: [{
        bangumiId: 1,
        modifiedMs: 42,
        points: [{ id: 'p1', name: '須賀神社', geo: [35.0288, 135.7797] }],
        theme: null,
      }],
    }
    mocks.listPreloadChunk.mockResolvedValue(payload)

    const store = createMemoryCacheStore()
    const deps = createDeps({ preloadEdgeCache: store })
    const handlers = createChunkHandlers(deps)

    const missRes = await handlers.GET(
      new Request('http://localhost/api/anitabi/preload/chunks/0?locale=zh'),
      { index: '0' },
    )
    expect(missRes.headers.get('x-preload-edge-cache')).toBe('miss')

    const hitRes = await handlers.GET(
      new Request('http://localhost/api/anitabi/preload/chunks/0?locale=zh'),
      { index: '0' },
    )
    expect(hitRes.headers.get('x-preload-edge-cache')).toBe('hit')
    expect(mocks.listPreloadChunk).toHaveBeenCalledTimes(1)
    await expect(missRes.json()).resolves.toEqual(payload)
    await expect(hitRes.json()).resolves.toEqual(payload)
    // s-maxage=300 过期语义必须保留（不允许永久 stale）
    expect(hitRes.headers.get('Cache-Control')).toBe('public, s-maxage=300, stale-while-revalidate=1800')
  })

  it('cache write goes through ctx.waitUntil and is keyed by locale + index', async () => {
    mocks.listPreloadChunk.mockResolvedValue({ datasetVersion: 'v1', index: 2, items: [] })
    const store = createMemoryCacheStore()
    const waitUntil = vi.fn()
    const deps = createDeps({ preloadEdgeCache: store, ctx: { waitUntil } })

    await createChunkHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/preload/chunks/2?locale=zh'),
      { index: '2' },
    )

    expect(store.putSpy).toHaveBeenCalledTimes(1)
    const [keyRequest] = store.putSpy.mock.calls[0] as unknown as [Request]
    expect(keyRequest.url).toContain('/chunks/2')
    expect(keyRequest.url).toContain('locale=zh')
    expect(waitUntil).toHaveBeenCalledTimes(1)

    // 不同 locale / 不同 index 不共享缓存条目
    await createChunkHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/preload/chunks/2?locale=ja'),
      { index: '2' },
    )
    await createChunkHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/preload/chunks/3?locale=zh'),
      { index: '3' },
    )
    expect(mocks.listPreloadChunk).toHaveBeenCalledTimes(3)
  })

  it('manifest handler serves from the edge cache on the second call', async () => {
    mocks.getPreloadManifest.mockResolvedValue({
      datasetVersion: 'v9',
      modifiedMs: 5,
      chunkSize: 200,
      chunkCount: 0,
      tabs: { nearby: [], latest: [], recent: [], hot: [] },
    })
    const store = createMemoryCacheStore()
    const deps = createDeps({ preloadEdgeCache: store })
    const handlers = createManifestHandlers(deps)

    await handlers.GET(new Request('http://localhost/api/anitabi/preload/manifest?locale=zh'))
    const hit = await handlers.GET(new Request('http://localhost/api/anitabi/preload/manifest?locale=zh'))

    expect(mocks.getPreloadManifest).toHaveBeenCalledTimes(1)
    expect(hit.headers.get('x-preload-edge-cache')).toBe('hit')
    await expect(hit.json()).resolves.toMatchObject({ datasetVersion: 'v9' })
  })

  it('explicit null store disables caching entirely (rollback path)', async () => {
    mocks.listPreloadChunk.mockResolvedValue({ datasetVersion: 'v1', index: 0, items: [] })
    const deps = createDeps({ preloadEdgeCache: null })
    const handlers = createChunkHandlers(deps)

    for (let i = 0; i < 2; i += 1) {
      const res = await handlers.GET(
        new Request('http://localhost/api/anitabi/preload/chunks/0?locale=zh'),
        { index: '0' },
      )
      expect(res.headers.get('x-preload-edge-cache')).toBeNull()
    }
    expect(mocks.listPreloadChunk).toHaveBeenCalledTimes(2)
  })

  it('non-200 responses are never written to the cache', async () => {
    mocks.listPreloadChunk.mockRejectedValue(new Error('db down'))
    const store = createMemoryCacheStore()
    const deps = createDeps({ preloadEdgeCache: store })

    await expect(
      createChunkHandlers(deps).GET(
        new Request('http://localhost/api/anitabi/preload/chunks/0?locale=zh'),
        { index: '0' },
      ),
    ).rejects.toThrow('db down')

    expect(store.putSpy).not.toHaveBeenCalled()
  })
})
