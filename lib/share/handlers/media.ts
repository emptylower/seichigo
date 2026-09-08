import type { ShareLinkRepo } from '@/lib/share/repo'
import { checkinPhotoKey, type ShareStore } from '@/lib/share/store'
import { isShareCode } from '@/lib/share/shortCode'

const IMMUTABLE = 'public, max-age=31536000, immutable'

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

function imageHeaders(contentType: string): Headers {
  const headers = new Headers()
  headers.set('content-type', contentType || 'image/jpeg')
  headers.set('cache-control', IMMUTABLE)
  headers.set('x-content-type-options', 'nosniff')
  return headers
}

/** ASSET_STORE 没有公共域，卡片一律走这条路由（与 /assets/<id> 同一套路） */
export function createGetShareImageHandler(deps: {
  repo: ShareLinkRepo
  getStore: () => ShareStore | null
}) {
  return async function getShareImage(
    _req: Request,
    ctx: { params: Promise<{ code: string }> },
  ): Promise<Response> {
    const { code } = await ctx.params
    if (!isShareCode(code)) return notFound()
    const link = await deps.repo.findByCode(code)
    if (!link?.imageKey) return notFound()
    // 卡片对象只允许落在 share/ 前缀下，防止脏数据把读取引到桶里其他对象
    if (!link.imageKey.startsWith('share/')) return notFound()
    const store = deps.getStore()
    if (!store) return notFound()
    const object = await store.get(link.imageKey).catch(() => null)
    if (!object) return notFound()
    return new Response(object.body, { status: 200, headers: imageHeaders(object.contentType) })
  }
}

/** UserPointState.photoUrl 指过来的公开读取地址 */
export function createGetCheckinPhotoHandler(deps: { getStore: () => ShareStore | null }) {
  return async function getCheckinPhoto(
    _req: Request,
    ctx: { params: Promise<{ userId: string; pointId: string }> },
  ): Promise<Response> {
    const { userId, pointId } = await ctx.params
    if (!userId || !pointId) return notFound()
    // Next 会把 %2F 解码回 /，显式挡掉路径穿越
    if (userId.includes('/') || pointId.includes('/')) return notFound()
    if (userId.includes('..') || pointId.includes('..')) return notFound()
    const store = deps.getStore()
    if (!store) return notFound()
    const object = await store.get(checkinPhotoKey(userId, pointId)).catch(() => null)
    if (!object) return notFound()
    return new Response(object.body, { status: 200, headers: imageHeaders(object.contentType) })
  }
}
