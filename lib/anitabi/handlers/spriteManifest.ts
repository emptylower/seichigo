import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import {
  buildPreloadCacheKey,
  serveFromPreloadEdgeCache,
} from '@/lib/anitabi/preloadEdgeCache'
import { coverSpriteAtlasKey } from '@/lib/anitabi/coverSpriteAtlas'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    /** atlas：R2 读 + 边缘缓存；未生成时 404，客户端按无 sprite 回落。 */
    async GET() {
      return serveFromPreloadEdgeCache(
        buildPreloadCacheKey('/sprite', 'shared'),
        {
          store: deps.preloadEdgeCache,
          waitUntil: deps.ctx?.waitUntil,
        },
        async () => {
          const bucket = deps.env?.MAP_IMAGE_CACHE
          if (!bucket) {
            return NextResponse.json({ error: 'sprite 未配置' }, { status: 404 })
          }
          try {
            const obj = await bucket.get(coverSpriteAtlasKey())
            if (!obj) {
              return NextResponse.json({ error: 'sprite 未生成' }, { status: 404 })
            }
            const bytes = await obj.arrayBuffer()
            return new NextResponse(bytes, {
              status: 200,
              headers: {
                'Content-Type': obj.httpMetadata?.contentType || 'application/json',
                'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
              },
            })
          } catch (err) {
            console.error('[api/anitabi/sprite] atlas read failed', err)
            return NextResponse.json({ error: '服务器错误' }, { status: 500 })
          }
        },
      )
    },
  }
}
