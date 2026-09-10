/**
 * 档 2 边缘缓存（2026-09-10 Lane A 任务 2 → 同日 SWR 改造）：
 *
 * 实测 `/api/anitabi/preload/*` TTFB 2.5s、响应无 `cf-cache-status` —— Worker 没开
 * Workers Caching（wrangler `cache.enabled`，需 wrangler ≥ 4.69 且要评估全局缓存
 * 影响半径，未单方面打开），Next 附加的 `vary: rsc, next-router-state-tree, …`
 * 又让任何 HTTP 层缓存都无法命中。本模块在 handler 内显式用 Cloudflare Cache API
 * （`caches.default`）自建边缘缓存：
 *
 * - key：endpoint + locale（+ chunk index / sprite version），与请求 URL 解耦，
 *   天然无视 vary；
 * - 真 stale-while-revalidate：`caches.default` 按 colo 分别缓存，而 `/map` 实测
 *   平均仅 ~0.7 req/min 且分散全球，TTL 300s 下单个 colo 十几分钟等不到第二个
 *   请求，纯 fresh TTL 在真实流量下几乎不命中。因此读取分三态：
 *   新鲜（≤ FRESH_TTL）→ `hit` 直返；过期但在 stale 窗口内 → `stale` 立即返回
 *   旧内容并经 `ctx.waitUntil` 后台 revalidate 回写（访客不等待）；超出 stale
 *   窗口或无缓存/旧格式条目 → `miss` 正常 compute；
 * - 存储 TTL 与浏览器 TTL 分离：cache.put 的条目寿命由写入响应的
 *   `cloudflare-cdn-cache-control` 决定——该 CF 专用头优先级最高、压过
 *   cache-control（2026-09-10 生产实测：只改 cache-control 被 compute 响应自带
 *   的专用头 max-age=300 压掉，300s 后条目被边缘逐出，stale 分支永远 miss）。因此
 *   存储条目在专用头上写 `max-age=FRESH+STALE`，`cache-control` 保持浏览器口径
 *   原值（preload 是 s-maxage=300，spriteSheet 是 immutable 1y），直返无需还原；
 * - 后台 revalidate 防并发风暴：模块级 in-flight Map，同一 key 同时只有一个在飞；
 * - put / revalidate 一律经 `ctx.waitUntil` 后台执行（本仓库 open-next.config.ts
 *   对队列投递踩过同样的坑：不进 waitUntil 的后台任务会被 isolate 提前回收）。
 *   waitUntil 宿主优先取调用方注入，缺省从 `getCfBindings()?.ctx` 解析
 *   （与 open-next.config.ts 的 `getCloudflareContext().ctx` 同源），且必须
 *   以方法形式在宿主上调用——裸取方法引用再调用在 Workers 上会抛
 *   "Illegal invocation"（lib/share/background.ts 2026-09-08 实测同款坑）；
 * - 无 `caches`（next dev / vitest / Node）时整体退化为直通，行为与旧版一致；
 *   无 waitUntil 宿主时 put / revalidate 退化为浮动 promise（同样直通）。
 */
import { NextResponse } from 'next/server'
import { getCfBindings, type CfBindingsCtx } from '@/lib/anitabi/cf/bindings'

const KEY_ORIGIN = 'https://preload-edge-cache.anitabi.seichigo.internal'

// —— TTL 口径（2026-09-10 SWR 改造）——
// fresh 300s：保持既有 s-maxage=300 语义（点位数据最多落后一个镜像周期）。
// stale 窗口 24h：点位数据变化很慢（镜像 cron 5 分钟增量同步），落后一个 fresh
//   周期完全可接受；把「过期即 miss 重算 3-4s」变成「秒回旧值 + 后台刷新」，
//   冷 colo 上的绝大多数访客由此受益。
// 存储 TTL = fresh + stale：条目寿命由写入响应的 cloudflare-cdn-cache-control
//   决定（优先级最高的 CF 专用头），必须 ≥ fresh+stale，否则 stale 窗口未过完
//   条目先被边缘逐出，SWR 失效。
const FRESH_TTL_SECONDS = 300
const STALE_WINDOW_SECONDS = 24 * 60 * 60
const STORAGE_TTL_SECONDS = FRESH_TTL_SECONDS + STALE_WINDOW_SECONDS
const FRESH_TTL_MS = FRESH_TTL_SECONDS * 1000
const STALE_WINDOW_MS = STALE_WINDOW_SECONDS * 1000

/** 存储条目私有头：写入时刻（epoch ms），读取时判定新鲜度。 */
const CACHED_AT_HEADER = 'x-preload-cached-at'
/**
 * 存储条目的边缘寿命头：cloudflare-cdn-cache-control 的优先级高于 cache-control
 * （Workers 缓存头优先级，https://developers.cloudflare.com/workers/cache/configuration/），
 * 条目实际寿命由它决定，写入 fresh+stale 长 TTL；Cloudflare 返回客户端前会剥掉它。
 */
const EDGE_TTL_HEADER = 'cloudflare-cdn-cache-control'

export type PreloadCacheStore = {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<unknown>
}

export type PreloadEdgeCacheOptions = {
  /** 显式传入缓存存储（测试替身）；undefined 时运行时解析 caches.default。 */
  store?: PreloadCacheStore | null
  /**
   * waitUntil 的宿主对象（ExecutionContext 的结构子集）。必须整对象传入、
   * 由本模块以 `host.waitUntil(...)` 方法形式调用——裸取方法引用脱离 this
   * 在 Workers 上会抛 "Illegal invocation"。undefined 时运行时从
   * `getCfBindings()?.ctx` 解析（getCloudflareContext 同源）；显式 null 表示
   * 关闭（put / revalidate 退化为浮动 promise，测试/回滚用）。
   */
  ctx?: CfBindingsCtx | null
}

function resolveRuntimeCacheStore(): PreloadCacheStore | null {
  const cachesRef = (globalThis as { caches?: { default?: PreloadCacheStore } }).caches
  return cachesRef?.default ?? null
}

/** 运行时解析 waitUntil 宿主：当前请求的 Cloudflare context（与 getCloudflareContext 同源）。 */
function resolveRuntimeWaitUntilHost(): CfBindingsCtx | null {
  return getCfBindings()?.ctx ?? null
}

/** 缓存 key 与请求 URL 解耦：locale 已归一，index 已 clamp，无用户态输入。 */
export function buildPreloadCacheKey(pathname: string, locale: string): Request {
  return new Request(
    `${KEY_ORIGIN}${pathname}?locale=${encodeURIComponent(locale)}`,
    { method: 'GET' },
  )
}

function withDiagnosticHeader(response: Response, value: 'hit' | 'stale' | 'miss'): Response {
  const rebuilt = new Response(response.body, response)
  rebuilt.headers.set('x-preload-edge-cache', value)
  return rebuilt
}

/**
 * 把 compute 响应转成存储条目（消耗传入响应的 body）：
 * - 存储 TTL 写进 `cloudflare-cdn-cache-control`（fresh+stale）：条目寿命由它
 *   决定，且优先级高于 cache-control——只改 cache-control 会被 compute 响应自带
 *   的专用头 max-age=300 压掉，300s 后条目被边缘逐出、stale 形同虚设
 *   （2026-09-10 生产实测踩坑）；
 * - `cache-control` 保持浏览器口径原值不动（preload s-maxage=300 / spriteSheet
 *   immutable 1y），命中/过期直返，无需任何还原逻辑；
 * - `x-preload-cached-at` 记写入时刻，读取时判定 hit/stale/miss。
 */
function toStorageResponse(source: Response, cachedAtMs: number): Response {
  const stored = new Response(source.body, source)
  stored.headers.set(EDGE_TTL_HEADER, `public, max-age=${STORAGE_TTL_SECONDS}`)
  stored.headers.set(CACHED_AT_HEADER, String(cachedAtMs))
  return stored
}

/**
 * 缓存条目 → 浏览器响应：`cache-control` 写入时未被篡改、原样直返（preload
 * s-maxage=300 / spriteSheet immutable 1y）；剥掉存储私有头（cached-at 与存储用
 * 边缘 TTL 头），绝不让长存储 TTL 泄漏给调用方（正确性不依赖 CF 剥头行为）。
 */
function toBrowserResponse(cached: Response, state: 'hit' | 'stale'): Response {
  const rebuilt = new Response(cached.body, cached)
  rebuilt.headers.delete(CACHED_AT_HEADER)
  rebuilt.headers.delete(EDGE_TTL_HEADER)
  rebuilt.headers.set('x-preload-edge-cache', state)
  return rebuilt
}

function warnCacheError(action: string, key: Request, err: unknown): void {
  console.warn(
    `[preload-edge-cache] ${action} failed for ${key.url}: ${err instanceof Error ? err.message : String(err)}`,
  )
}

/** 经宿主方法形式 waitUntil 调度后台任务；无宿主时退化为浮动 promise（直通旧行为）。 */
function scheduleBackground(
  host: CfBindingsCtx | null,
  task: Promise<unknown>,
): void {
  // 方法形式调用（this = host）：裸调用会抛 "Illegal invocation"。
  if (host && typeof host.waitUntil === 'function') {
    host.waitUntil(task)
  }
}

/** 同一 key 同时只允许一个在飞的 revalidate（模块级 in-flight Map）。 */
const inFlightRevalidates = new Map<string, Promise<void>>()

/**
 * 后台 revalidate：重新 compute 并以新时间戳回写缓存。任务整体（含 put）作为一个
 * promise 交给 waitUntil；失败只 warn，不影响已返回给访客的 stale 响应。
 */
function scheduleRevalidate(
  store: PreloadCacheStore,
  key: Request,
  compute: () => Promise<Response>,
  host: CfBindingsCtx | null,
): void {
  const url = key.url
  if (inFlightRevalidates.has(url)) return
  const job = (async () => {
    try {
      const fresh = await compute()
      if (fresh.status === 200) {
        await store.put(key, toStorageResponse(fresh, Date.now()))
      }
    } catch (err) {
      warnCacheError('revalidate', key, err)
    } finally {
      inFlightRevalidates.delete(url)
    }
  })()
  // 同步占位（async IIFE 到首个 await 前同步执行），并发请求在同一事件循环回合内
  // 只会有一份 check-and-set，不会双发 revalidate。
  inFlightRevalidates.set(url, job)
  scheduleBackground(host, job)
}

function scheduleCachePut(
  store: PreloadCacheStore,
  key: Request,
  response: Response,
  host: CfBindingsCtx | null,
): void {
  const write = store
    .put(key, toStorageResponse(response.clone(), Date.now()))
    .catch((err: unknown) => warnCacheError('put', key, err))
  scheduleBackground(host, write)
}

/**
 * preload 端点统一出口：先查边缘缓存，按三态（hit / stale / miss）返回；
 * miss 时执行 compute 并把 200 响应写回缓存（后台、不阻塞响应）。
 * 任何一步失败都退化为直通 compute。
 */
export async function serveFromPreloadEdgeCache(
  key: Request,
  options: PreloadEdgeCacheOptions,
  compute: () => Promise<Response>,
): Promise<Response> {
  const store = options.store !== undefined ? options.store : resolveRuntimeCacheStore()
  const waitHost = options.ctx !== undefined ? options.ctx : resolveRuntimeWaitUntilHost()
  if (!store) {
    return compute()
  }

  try {
    const cached = await store.match(key)
    if (cached) {
      // 旧格式条目（无 cached-at，本版之前写入、TTL 300s 内自然消亡）按 miss 处理
      const cachedAtMs = Number(cached.headers.get(CACHED_AT_HEADER))
      if (Number.isFinite(cachedAtMs) && cachedAtMs > 0) {
        const ageMs = Date.now() - cachedAtMs
        if (ageMs <= FRESH_TTL_MS) {
          return toBrowserResponse(cached, 'hit')
        }
        if (ageMs <= FRESH_TTL_MS + STALE_WINDOW_MS) {
          // 立即返回旧内容，后台刷新；访客不等待
          scheduleRevalidate(store, key, compute, waitHost)
          return toBrowserResponse(cached, 'stale')
        }
      }
      // 超出 stale 窗口：落入 miss，compute 后覆盖写
    }
  } catch (err) {
    warnCacheError('match', key, err)
  }

  const response = await compute()
  if (response.status === 200) {
    try {
      scheduleCachePut(store, key, response, waitHost)
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
    // 该头仅 Cloudflare 消费，浏览器忽略；进 caches.default 存储时会被
    // toStorageResponse 覆盖为 fresh+stale 长 TTL（专用头优先级压过 cache-control）。
    'cloudflare-cdn-cache-control': 'public, max-age=300, stale-while-revalidate=1800',
    // Next 对所有 app 路由无条件 append `vary: rsc, next-router-state-tree, …`；
    // 显式声明一个稳定的 Vary 可覆盖它（见任务 2 验收：vary 必须去除）。
    Vary: 'accept-encoding',
  }
}

export function preloadJsonResponse(data: unknown): NextResponse {
  return NextResponse.json(data, { headers: preloadCacheResponseHeaders() })
}
