import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import {
  buildPreloadCacheKey,
  serveFromPreloadEdgeCache,
} from '@/lib/anitabi/preloadEdgeCache'
import { coverSpriteSheetKey, isCoverSpriteVersion } from '@/lib/anitabi/coverSpriteAtlas'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    /** sheet：hash 版本号不可变，边缘缓存 + 浏览器长缓存。 */
    async GET(req: Request) {
      const url = new URL(req.url)
      const version = url.searchParams.get('v') || ''
      if (!isCoverSpriteVersion(version)) {
        return NextResponse.json({ error: '非法版本号' }, { status: 400 })
      }

      return serveFromPreloadEdgeCache(
        buildPreloadCacheKey('/sprite/sheet', version),
        {
          store: deps.preloadEdgeCache,
          // 整对象传递，由 preloadEdgeCache 以方法形式调用（防 Illegal invocation）
          ctx: deps.ctx,
        },
        async () => {
          const bucket = deps.env?.MAP_IMAGE_CACHE
          if (!bucket) {
            return NextResponse.json({ error: 'sprite 未配置' }, { status: 404 })
          }
          try {
            const obj = await bucket.get(coverSpriteSheetKey(version))
            if (!obj) {
              return NextResponse.json({ error: 'sprite 不存在' }, { status: 404 })
            }
            const bytes = await obj.arrayBuffer()
            return new NextResponse(bytes, {
              status: 200,
              headers: {
                'Content-Type': 'image/webp',
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            })
          } catch (err) {
            console.error('[api/anitabi/sprite/sheet] read failed', err)
            return NextResponse.json({ error: '服务器错误' }, { status: 500 })
          }
        },
      )
    },
  }
}
