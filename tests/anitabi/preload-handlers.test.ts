import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

// ---- Cloudflare context 全局槽管理 ----
// getCfBindings()（getCloudflareContext 的同源实现）从 globalThis 上的这个
// symbol 槽读当前请求的 env/ctx。测试直接操作真实槽位而不是 mock 模块，
// 保证「生产从运行时解析 waitUntil 宿主」这条默认路径被真实覆盖。

const CF_CONTEXT_SLOT = Symbol.for('__cloudflare-context__')
type GlobalWithCfSlot = Record<symbol, unknown>

let cfSlotBackup: unknown
let hadCfSlot: boolean

beforeEach(() => {
  vi.resetAllMocks()
  const g = globalThis as GlobalWithCfSlot
  hadCfSlot = CF_CONTEXT_SLOT in g
  cfSlotBackup = g[CF_CONTEXT_SLOT]
  delete g[CF_CONTEXT_SLOT]
})

afterEach(() => {
  const g = globalThis as GlobalWithCfSlot
  if (hadCfSlot) g[CF_CONTEXT_SLOT] = cfSlotBackup
  else delete g[CF_CONTEXT_SLOT]
})

/**
 * 严格宿主替身：waitUntil 不以宿主对象为 this 调用就抛 "Illegal invocation"。
 * 用来证明调用方是方法形式调用（ctx.waitUntil(...)）而非裸方法引用——
 * Workers 的 ExecutionContext.prototype.waitUntil 正是这种 this 校验语义。
 */
type StrictWaitUntilHost = { waitUntil(promise: Promise<unknown>): void }

function createStrictWaitUntilHost(): { host: StrictWaitUntilHost; calls: Promise<unknown>[] } {
  const calls: Promise<unknown>[] = []
  const host: StrictWaitUntilHost = {
    waitUntil(promise) {
      if (this !== host) {
        throw new TypeError('Illegal invocation: waitUntil 必须以宿主对象为 this 调用')
      }
      calls.push(promise)
    },
  }
  return { host, calls }
}

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
    const { host, calls } = createStrictWaitUntilHost()
    const deps = createDeps({ preloadEdgeCache: store, ctx: host })

    await createChunkHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/preload/chunks/2?locale=zh'),
      { index: '2' },
    )

    expect(store.putSpy).toHaveBeenCalledTimes(1)
    const [keyRequest] = store.putSpy.mock.calls[0] as unknown as [Request]
    expect(keyRequest.url).toContain('/chunks/2')
    expect(keyRequest.url).toContain('locale=zh')
    expect(calls).toHaveLength(1)

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

describe('preload edge cache waitUntil 接线（Illegal invocation 防护）', () => {
  it('严格替身自证：裸提取调用抛错、方法调用不抛（证明替身能抓住 this 绑定缺陷）', () => {
    const { host } = createStrictWaitUntilHost()

    const bare = host.waitUntil
    expect(() => bare(Promise.resolve())).toThrow(/Illegal invocation/)
    expect(() => host.waitUntil(Promise.resolve())).not.toThrow()
  })

  it('缓存写入以宿主方法形式调用 waitUntil，不触发 Illegal invocation', async () => {
    mocks.listPreloadChunk.mockResolvedValue({ datasetVersion: 'v1', index: 5, items: [] })
    const store = createMemoryCacheStore()
    const { host, calls } = createStrictWaitUntilHost()
    const deps = createDeps({ preloadEdgeCache: store, ctx: host })

    const res = await createChunkHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/preload/chunks/5?locale=zh'),
      { index: '5' },
    )

    expect(res.headers.get('x-preload-edge-cache')).toBe('miss')
    // 替身会在 this !== 宿主 时抛错——收到 promise 即证明是方法形式调用
    expect(calls).toHaveLength(1)
    await calls[0] // put promise 完成不抛

    const hit = await createChunkHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/preload/chunks/5?locale=zh'),
      { index: '5' },
    )
    expect(hit.headers.get('x-preload-edge-cache')).toBe('hit')
  })

  it('默认路径：不注入 deps.ctx 也能从运行时 Cloudflare context 拿到 waitUntil', async () => {
    mocks.getPreloadManifest.mockResolvedValue({
      datasetVersion: 'v3',
      modifiedMs: 7,
      chunkSize: 200,
      chunkCount: 0,
      tabs: { nearby: [], latest: [], recent: [], hot: [] },
    })
    const store = createMemoryCacheStore()
    const { host, calls } = createStrictWaitUntilHost()
    // 模拟 OpenNext worker 入口把当前请求的 ExecutionContext 挂到全局槽
    // （getCfBindings 的真实数据源，与 getCloudflareContext() 同源）
    ;(globalThis as GlobalWithCfSlot)[CF_CONTEXT_SLOT] = { ctx: host }

    // 注意：deps 不带 ctx——生产默认路径，route/handler 都没人填 deps.ctx
    const deps = createDeps({ preloadEdgeCache: store })
    const res = await createManifestHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/preload/manifest?locale=zh'),
    )

    expect(res.headers.get('x-preload-edge-cache')).toBe('miss')
    // this 校验替身未抛错 + 收到 promise：默认路径拿到了受保护的 waitUntil
    expect(calls).toHaveLength(1)
  })

  it('取不到 Cloudflare context 时不抛错，退化为直通（浮动 put 仍写缓存）', async () => {
    mocks.listPreloadChunk.mockResolvedValue({ datasetVersion: 'v1', index: 7, items: [] })
    const store = createMemoryCacheStore()
    const deps = createDeps({ preloadEdgeCache: store }) // 无 ctx，全局槽已清

    const handlers = createChunkHandlers(deps)
    const first = await handlers.GET(
      new Request('http://localhost/api/anitabi/preload/chunks/7?locale=zh'),
      { index: '7' },
    )
    expect(first.headers.get('x-preload-edge-cache')).toBe('miss')

    // 浮动 put 最终落库：微任务排空后第二次请求命中
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = await handlers.GET(
      new Request('http://localhost/api/anitabi/preload/chunks/7?locale=zh'),
      { index: '7' },
    )
    expect(second.headers.get('x-preload-edge-cache')).toBe('hit')
    expect(mocks.listPreloadChunk).toHaveBeenCalledTimes(1)
  })
})
