/**
 * 2026-09-10 任务 2（档 1 卫生项）：剥掉 Next 对 app 路由无条件追加的
 * `vary: rsc, next-router-state-tree, next-router-prefetch,
 * next-router-segment-prefetch`。
 *
 * 这些头只会在 Next 客户端路由（RSC 导航）里出现；地图前端对 preload 端点的
 * plain fetch 永远不带它们，该 vary 只会把响应在 HTTP 层缓存里拆成名义变体、
 * 白白降低命中率。handler 层无法去除（Next 在渲染管线早期 appendHeader，晚于
 * handler 设置的 Vary 也会并列成两行），只能在 Worker 出口统一清洗。
 *
 * 只处理 /api/anitabi/preload/ 前缀，其余路径原样透传；保留该前缀响应里
 * 其他有意义的 vary token（如 accept-encoding）。
 */

const PRELOAD_VARY_STRIP_PATH_PREFIX = '/api/anitabi/preload/'

const NEXT_ROUTER_VARY_TOKENS = new Set([
  'rsc',
  'next-router-state-tree',
  'next-router-prefetch',
  'next-router-segment-prefetch',
  'next-hmr-refresh',
])

function stripNextRouterVaryValues(rawValue: string | null): string | null {
  if (!rawValue) return null
  const kept = rawValue
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !NEXT_ROUTER_VARY_TOKENS.has(token.toLowerCase()))
  if (kept.length === 0) return null
  return kept.join(', ')
}

export function isPreloadVaryStripPath(pathname: string): boolean {
  return pathname.startsWith(PRELOAD_VARY_STRIP_PATH_PREFIX)
}

/**
 * 清洗 preload 响应的 vary 头。非目标路径或无需变更时原样返回入参引用
 * （零拷贝）；需要变更时重建 Response（body 流原样透传）。
 */
export function stripNextRouterVaryFromResponse(
  requestUrl: string,
  response: Response,
): Response {
  let pathname: string
  try {
    pathname = new URL(requestUrl).pathname
  } catch {
    return response
  }
  if (!isPreloadVaryStripPath(pathname)) return response

  const varyValues: string[] = []
  let sawRouterVary = false
  // Headers.getSetCookie 不适用于 vary；逐行收集（多行 vary 是合法的重复头，
  // 部分运行时也会把重复 vary 合并成单行——两种形态都能被下面的清洗处理）。
  const collected: string[] = []
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'vary') collected.push(value)
  })
  for (const value of collected) {
    const cleaned = stripNextRouterVaryValues(value)
    if (cleaned !== value) sawRouterVary = true
    if (cleaned) varyValues.push(cleaned)
  }
  if (!sawRouterVary) return response

  const headers = new Headers(response.headers)
  headers.delete('vary')
  for (const value of varyValues) {
    headers.append('vary', value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
