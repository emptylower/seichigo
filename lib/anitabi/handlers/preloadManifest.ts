import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { getPreloadManifest } from '@/lib/anitabi/read'
import { normalizeLocale } from '@/lib/anitabi/utils'
import {
  buildPreloadCacheKey,
  preloadJsonResponse,
  serveFromPreloadEdgeCache,
} from '@/lib/anitabi/preloadEdgeCache'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      const url = new URL(req.url)
      const locale = normalizeLocale(url.searchParams.get('locale'))

      return serveFromPreloadEdgeCache(
        buildPreloadCacheKey('/manifest', locale),
        {
          store: deps.preloadEdgeCache,
          // 整对象传递，由 preloadEdgeCache 以方法形式调用（防 Illegal invocation）；
          // 未注入时自行从运行时 Cloudflare context 解析
          ctx: deps.ctx,
        },
        async () => {
          const data = await getPreloadManifest({
            prisma: deps.prisma,
            locale,
          })

          return preloadJsonResponse(data)
        },
      )
    },
  }
}
