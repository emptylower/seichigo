import { describe, expect, it, vi } from 'vitest'
import {
  buildPreloadCacheKey,
  preloadCacheResponseHeaders,
  serveFromPreloadEdgeCache,
  type PreloadCacheStore,
} from '@/lib/anitabi/preloadEdgeCache'

/**
 * SWR 单测：直接测 serveFromPreloadEdgeCache 的三态语义（hit / stale / miss）。
 * 存储条目格式是本模块对外契约的一部分（caches.default 替身按 url 存 Response），
 * 测试用与实现一致的存储头直接播种，顺带锁定该格式。
 */

const BROWSER_CC = preloadCacheResponseHeaders()['Cache-Control']
// 存储 TTL 契约：fresh(300s) + stale(24h) = 86700s，写在 cloudflare-cdn-cache-control
// （优先级高于 cache-control，条目寿命由它决定），见实现内注释
const STORAGE_EDGE_CC = 'public, max-age=86700'
const FRESH_MS = 300_000
const STALE_WINDOW_MS = 24 * 60 * 60_000

function browserJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': BROWSER_CC },
  })
}

/** 生产口径 compute：preload 端点响应自带完整头集（含 cf 专用头 max-age=300）。 */
function preloadComputeResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', ...preloadCacheResponseHeaders() },
  })
}

function storedJsonResponse(
  payload: unknown,
  cachedAtMs: number,
  browserCc: string = BROWSER_CC,
): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // cache-control 写入时未被篡改，保持浏览器口径原值
      'cache-control': browserCc,
      'cloudflare-cdn-cache-control': STORAGE_EDGE_CC,
      'x-preload-cached-at': String(cachedAtMs),
    },
  })
}

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

/** 播种存储条目（绕过 putSpy，不计入写入次数断言）。 */
function seed(store: ReturnType<typeof createMemoryCacheStore>, key: Request, response: Response): void {
  store.entries.set(key.url, response)
}

/**
 * 严格宿主替身：waitUntil 不以宿主对象为 this 调用就抛 "Illegal invocation"，
 * 证明调用方是方法形式调用（Workers ExecutionContext 同款 this 校验语义）。
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

describe('preload edge cache stale-while-revalidate', () => {
  it('新鲜期内：hit 直返，不触发 revalidate，也不重写缓存', async () => {
    const store = createMemoryCacheStore()
    const key = buildPreloadCacheKey('/chunks/0', 'zh')
    seed(store, key, storedJsonResponse({ v: 'fresh-entry' }, Date.now() - 1_000))
    const { host, calls } = createStrictWaitUntilHost()
    const compute = vi.fn(async () => browserJsonResponse({ v: 'recomputed' }))

    const res = await serveFromPreloadEdgeCache(key, { store, ctx: host }, compute)

    expect(res.headers.get('x-preload-edge-cache')).toBe('hit')
    await expect(res.json()).resolves.toEqual({ v: 'fresh-entry' })
    expect(compute).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
    expect(store.putSpy).not.toHaveBeenCalled()
    // 浏览器侧口径：存储私有头与存储用边缘 TTL 头都不泄漏
    expect(res.headers.get('cache-control')).toBe(BROWSER_CC)
    expect(res.headers.get('x-preload-cached-at')).toBeNull()
    expect(res.headers.get('cloudflare-cdn-cache-control')).toBeNull()
  })

  it('stale 窗口内：立即返回旧内容且标 stale，经宿主 waitUntil 调度一次后台 revalidate', async () => {
    const store = createMemoryCacheStore()
    const key = buildPreloadCacheKey('/chunks/0', 'zh')
    seed(store, key, storedJsonResponse({ v: 'old' }, Date.now() - 10 * 60_000))
    const { host, calls } = createStrictWaitUntilHost()
    // compute 永不自行 resolve：证明 stale 响应不等待它
    let release!: (response: Response) => void
    const compute = vi.fn(
      () => new Promise<Response>((resolve) => { release = resolve }),
    )

    const res = await serveFromPreloadEdgeCache(key, { store, ctx: host }, compute)

    expect(res.headers.get('x-preload-edge-cache')).toBe('stale')
    await expect(res.json()).resolves.toEqual({ v: 'old' })
    expect(compute).toHaveBeenCalledTimes(1)
    // 严格替身未抛 Illegal invocation 且收到 promise：revalidate 确实经宿主方法调度
    expect(calls).toHaveLength(1)

    release(browserJsonResponse({ v: 'new' }))
    await calls[0]
    // revalidate 完成后缓存是新内容，回到 hit
    const next = await serveFromPreloadEdgeCache(key, { store }, compute)
    expect(next.headers.get('x-preload-edge-cache')).toBe('hit')
    await expect(next.json()).resolves.toEqual({ v: 'new' })
  })

  it('同一 key 并发 stale 只发起一次 revalidate，不同 key 各自独立', async () => {
    const store = createMemoryCacheStore()
    const keyA = buildPreloadCacheKey('/chunks/0', 'zh')
    const keyB = buildPreloadCacheKey('/chunks/1', 'zh')
    seed(store, keyA, storedJsonResponse({ v: 'a-old' }, Date.now() - 10 * 60_000))
    seed(store, keyB, storedJsonResponse({ v: 'b-old' }, Date.now() - 10 * 60_000))
    const { host, calls } = createStrictWaitUntilHost()
    const compute = vi.fn(async () => browserJsonResponse({ v: 'recomputed' }))

    const [a1, a2, b1] = await Promise.all([
      serveFromPreloadEdgeCache(keyA, { store, ctx: host }, compute),
      serveFromPreloadEdgeCache(keyA, { store, ctx: host }, compute),
      serveFromPreloadEdgeCache(keyB, { store, ctx: host }, compute),
    ])

    expect(a1.headers.get('x-preload-edge-cache')).toBe('stale')
    expect(a2.headers.get('x-preload-edge-cache')).toBe('stale')
    expect(b1.headers.get('x-preload-edge-cache')).toBe('stale')
    await expect(a1.json()).resolves.toEqual({ v: 'a-old' })
    await expect(a2.json()).resolves.toEqual({ v: 'a-old' })
    await expect(b1.json()).resolves.toEqual({ v: 'b-old' })
    // keyA 两并发合并为 1 次 + keyB 1 次
    expect(compute).toHaveBeenCalledTimes(2)
    expect(calls).toHaveLength(2)
  })

  it('超出 stale 窗口：miss 走正常 compute 并覆盖旧条目', async () => {
    const store = createMemoryCacheStore()
    const key = buildPreloadCacheKey('/manifest', 'zh')
    seed(store, key, storedJsonResponse({ v: 'ancient' }, Date.now() - FRESH_MS - STALE_WINDOW_MS - 60_000))
    const { host, calls } = createStrictWaitUntilHost()
    const compute = vi.fn(async () => browserJsonResponse({ v: 'recomputed' }))

    const res = await serveFromPreloadEdgeCache(key, { store, ctx: host }, compute)

    expect(res.headers.get('x-preload-edge-cache')).toBe('miss')
    await expect(res.json()).resolves.toEqual({ v: 'recomputed' })
    expect(compute).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(1) // 覆盖写仍走 waitUntil
    await calls[0]

    const next = await serveFromPreloadEdgeCache(key, { store }, compute)
    expect(next.headers.get('x-preload-edge-cache')).toBe('hit')
    await expect(next.json()).resolves.toEqual({ v: 'recomputed' })
  })

  it('无 cached-at 的旧格式条目按 miss 处理', async () => {
    const store = createMemoryCacheStore()
    const key = buildPreloadCacheKey('/chunks/2', 'zh')
    const legacy = new Response(JSON.stringify({ v: 'legacy' }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': BROWSER_CC },
    })
    seed(store, key, legacy)
    const compute = vi.fn(async () => browserJsonResponse({ v: 'recomputed' }))

    const res = await serveFromPreloadEdgeCache(key, { store }, compute)

    expect(res.headers.get('x-preload-edge-cache')).toBe('miss')
    await expect(res.json()).resolves.toEqual({ v: 'recomputed' })
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('存储条目把长 TTL 写进 cloudflare-cdn-cache-control，cache-control 保持浏览器口径（2026-09-10 根因回归）', async () => {
    const store = createMemoryCacheStore()
    const key = buildPreloadCacheKey('/chunks/3', 'zh')
    const { host } = createStrictWaitUntilHost()
    // 生产口径 compute：响应自带 cloudflare-cdn-cache-control: max-age=300
    const compute = vi.fn(async () => preloadComputeResponse({ v: 'first' }))

    const res = await serveFromPreloadEdgeCache(key, { store, ctx: host }, compute)

    expect(res.headers.get('x-preload-edge-cache')).toBe('miss')
    // 返回给调用方：cache-control 仍是浏览器口径，不含存储长 TTL
    expect(res.headers.get('cache-control')).toBe(BROWSER_CC)
    expect(res.headers.get('cache-control')).not.toContain('86700')
    expect(res.headers.get('x-preload-cached-at')).toBeNull()

    expect(store.putSpy).toHaveBeenCalledTimes(1)
    const [keyRequest, stored] = store.putSpy.mock.calls[0] as unknown as [Request, Response]
    expect(keyRequest.url).toBe(key.url)
    // 钉死根因：写入缓存的响应上，条目寿命 = fresh+stale（86700s）且必须写在
    // 优先级最高的 cloudflare-cdn-cache-control 上——旧实现只改 cache-control，
    // 被 compute 自带的专用头 max-age=300 压掉，300s 后条目被边缘逐出、stale 永远 miss
    expect(stored.headers.get('cloudflare-cdn-cache-control')).toBe(STORAGE_EDGE_CC)
    expect(stored.headers.get('cache-control')).toBe(BROWSER_CC)
    expect(Number(stored.headers.get('x-preload-cached-at'))).toBeGreaterThan(0)
    expect(stored.headers.get('x-preload-browser-cc')).toBeNull()
  })

  it('spriteSheet 类 immutable 响应：存储侧边缘 TTL 仍写 fresh+stale，cache-control 保持 immutable 不被篡改', async () => {
    const store = createMemoryCacheStore()
    const key = buildPreloadCacheKey('/sprite/sheet', 'v1')
    const immutableCc = 'public, max-age=31536000, immutable'
    const { host } = createStrictWaitUntilHost()
    const compute = vi.fn(
      async () =>
        new Response(JSON.stringify({ sheet: true }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': immutableCc },
        }),
    )

    const res = await serveFromPreloadEdgeCache(key, { store, ctx: host }, compute)

    expect(res.headers.get('x-preload-edge-cache')).toBe('miss')
    expect(res.headers.get('cache-control')).toBe(immutableCc)

    expect(store.putSpy).toHaveBeenCalledTimes(1)
    const [, stored] = store.putSpy.mock.calls[0] as unknown as [Request, Response]
    expect(stored.headers.get('cloudflare-cdn-cache-control')).toBe(STORAGE_EDGE_CC)
    expect(stored.headers.get('cache-control')).toBe(immutableCc)
  })

  it('stale 返回的 cache-control 就是写入时的浏览器口径原值（sprite immutable 场景，无需还原）', async () => {
    const store = createMemoryCacheStore()
    const key = buildPreloadCacheKey('/sprite/sheet', 'v1')
    const immutableCc = 'public, max-age=31536000, immutable'
    seed(store, key, storedJsonResponse({ sheet: true }, Date.now() - 10 * 60_000, immutableCc))
    const compute = vi.fn(async () => browserJsonResponse({ sheet: true }))

    const res = await serveFromPreloadEdgeCache(key, { store }, compute)

    expect(res.headers.get('x-preload-edge-cache')).toBe('stale')
    expect(res.headers.get('cache-control')).toBe(immutableCc)
    expect(res.headers.get('cache-control')).not.toContain('86700')
    expect(res.headers.get('cloudflare-cdn-cache-control')).toBeNull()
  })

  it('无 waitUntil 宿主时 stale 仍立即返回，revalidate 以浮动 promise 落库', async () => {
    const store = createMemoryCacheStore()
    const key = buildPreloadCacheKey('/chunks/4', 'zh')
    seed(store, key, storedJsonResponse({ v: 'old' }, Date.now() - 10 * 60_000))
    const compute = vi.fn(async () => browserJsonResponse({ v: 'new' }))

    const res = await serveFromPreloadEdgeCache(key, { store }, compute)

    expect(res.headers.get('x-preload-edge-cache')).toBe('stale')
    await expect(res.json()).resolves.toEqual({ v: 'old' })
    expect(compute).toHaveBeenCalledTimes(1)

    // 排空浮动 promise 后新内容落库
    await new Promise((resolve) => setTimeout(resolve, 0))
    const next = await serveFromPreloadEdgeCache(key, { store }, compute)
    expect(next.headers.get('x-preload-edge-cache')).toBe('hit')
    await expect(next.json()).resolves.toEqual({ v: 'new' })
  })

  it('无缓存存储（显式 null）时直通 compute，无诊断头', async () => {
    const key = buildPreloadCacheKey('/manifest', 'en')
    const compute = vi.fn(async () => browserJsonResponse({ v: 'passthrough' }))

    const res = await serveFromPreloadEdgeCache(key, { store: null }, compute)

    expect(res.headers.get('x-preload-edge-cache')).toBeNull()
    await expect(res.json()).resolves.toEqual({ v: 'passthrough' })
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('贴近 fresh 边界（295s）仍算新鲜 hit，留 5s 钟差余量避免 Date.now 抖动', async () => {
    const store = createMemoryCacheStore()
    const key = buildPreloadCacheKey('/chunks/5', 'zh')
    seed(store, key, storedJsonResponse({ v: 'edge' }, Date.now() - (FRESH_MS - 5_000)))
    const compute = vi.fn(async () => browserJsonResponse({ v: 'recomputed' }))

    const res = await serveFromPreloadEdgeCache(key, { store }, compute)

    expect(res.headers.get('x-preload-edge-cache')).toBe('hit')
    expect(compute).not.toHaveBeenCalled()
  })
})
