/**
 * 档 2 边缘缓存（2026-09-10 Lane A 任务 2）：
 *
 * 实测 `/api/anitabi/preload/*` TTFB 2.5s、响应无 `cf-cache-status` —— Worker 没开
 * Workers Caching（wrangler `cache.enabled`，需 wrangler ≥ 4.69 且要评估全局缓存
 * 影响半径，未单方面打开），Next 附加的 `vary: rsc, next-router-state-tree, …`
 * 又让任何 HTTP 层缓存都无法命中。本模块在 handler 内显式用 Cloudflare Cache API
 * （`caches.default`）自建边缘缓存：
 *
 * - key：endpoint + locale（+ chunk index），与请求 URL 解耦，天然无视 vary；
 * - TTL：由被缓存响应的 `Cache-Control: s-maxage=300` 决定，过期自动消失，
 *   保留「点位数据最多 5 分钟 stale」的既有语义，不做永久缓存；
 * - put 一律经 `ctx.waitUntil` 后台执行（本仓库 open-next.config.ts 对队列
 *   投递踩过同样的坑：不进 waitUntil 的后台任务会被 isolate 提前回收）；
 * - 无 `caches`（next dev / vitest / Node）时整体退化为直通，行为与旧版一致。
 */
import { NextResponse } from 'next/server'

const KEY_ORIGIN = 'https://preload-edge-cache.anitabi.seichigo.internal'

export type PreloadCacheStore = {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<unknown>
}

export type PreloadEdgeCacheOptions = {
  /** 显式传入缓存存储（测试替身）；undefined 时运行时解析 caches.default。 */
  store?: PreloadCacheStore | null
  waitUntil?: (promise: Promise<unknown>) => void
}

function resolveRuntimeCacheStore(): PreloadCacheStore | null {
  const cachesRef = (globalThis as { caches?: { default?: PreloadCacheStore } }).caches
  return cachesRef?.default ?? null
}

/** 缓存 key 与请求 URL 解耦：locale 已归一，index 已 clamp，无用户态输入。 */
export function buildPreloadCacheKey(pathname: string, locale: string): Request {
  return new Request(
    `${KEY_ORIGIN}${pathname}?locale=${encodeURIComponent(locale)}`,
    { method: 'GET' },
  )
}

function withDiagnosticHeader(response: Response, value: 'hit' | 'miss'): Response {
  const rebuilt = new Response(response.body, response)
  rebuilt.headers.set('x-preload-edge-cache', value)
  return rebuilt
}

function scheduleCachePut(
  store: PreloadCacheStore,
  key: Request,
  response: Response,
  waitUntil: ((promise: Promise<unknown>) => void) | undefined,
): void {
  const write = store
    .put(key, response.clone())
    .catch((err: unknown) => {
      console.warn(
        `[preload-edge-cache] put failed for ${key.url}: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  if (waitUntil) {
    waitUntil(write)
  }
}

/**
 * preload 端点统一出口：先查边缘缓存，miss 时执行 compute 并把 200 响应
 * 写回缓存（后台、不阻塞响应）。任何一步失败都退化为直通 compute。
 */
export async function serveFromPreloadEdgeCache(
  key: Request,
  options: PreloadEdgeCacheOptions,
  compute: () => Promise<Response>,
): Promise<Response> {
  const store = options.store !== undefined ? options.store : resolveRuntimeCacheStore()
  if (!store) {
    return compute()
  }

  try {
    const cached = await store.match(key)
    if (cached) {
      return withDiagnosticHeader(cached, 'hit')
    }
  } catch (err) {
    console.warn(
      `[preload-edge-cache] match failed for ${key.url}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const response = await compute()
  if (response.status === 200) {
    try {
      scheduleCachePut(store, key, response, options.waitUntil)
    } catch {
      // put 调度失败不影响响应
    }
  }
  return withDiagnosticHeader(response, 'miss')
}

/** 统一的 preload 响应头（保持既有 s-maxage=300 过期语义）。 */
export function preloadCacheResponseHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
    // Cloudflare 边缘的 s-maxage 会禁用 stale-while-revalidate（RFC 9111 §4.2.4）；
    // 若将来开启 Workers Caching，专用头里用 max-age 表达边缘 TTL 以保留 SWR。
    // 该头仅 Cloudflare 消费，浏览器忽略。
    'cloudflare-cdn-cache-control': 'public, max-age=300, stale-while-revalidate=1800',
    // Next 对所有 app 路由无条件 append `vary: rsc, next-router-state-tree, …`；
    // 显式声明一个稳定的 Vary 可覆盖它（见任务 2 验收：vary 必须去除）。
    Vary: 'accept-encoding',
  }
}

export function preloadJsonResponse(data: unknown): NextResponse {
  return NextResponse.json(data, { headers: preloadCacheResponseHeaders() })
}
