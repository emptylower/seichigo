import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { listPreloadChunk } from '@/lib/anitabi/read'
import { clampInt, normalizeLocale } from '@/lib/anitabi/utils'
import {
  buildPreloadCacheKey,
  preloadJsonResponse,
  serveFromPreloadEdgeCache,
} from '@/lib/anitabi/preloadEdgeCache'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request, params: { index: string }) {
      const url = new URL(req.url)
      const locale = normalizeLocale(url.searchParams.get('locale'))
      const index = clampInt(params.index, 0, 0, 9999)

      // 档 2 边缘缓存：key 与请求 URL 解耦（locale+index），TTFB 2.5s → 缓存命中
      // 时只剩 Worker 调用 + cache match（目标 <200ms）；TTL 由响应头 s-maxage=300
      // 决定，过期语义不变。
      return serveFromPreloadEdgeCache(
        buildPreloadCacheKey(`/chunks/${index}`, locale),
        {
          store: deps.preloadEdgeCache,
          // 整对象传递，由 preloadEdgeCache 以方法形式调用（防 Illegal invocation）；
          // 未注入时自行从运行时 Cloudflare context 解析
          ctx: deps.ctx,
        },
        async () => {
          const data = await listPreloadChunk({
            prisma: deps.prisma,
            locale,
            index,
          })

          return preloadJsonResponse(data)
        },
      )
    },
  }
}
