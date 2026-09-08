import { getShareApiDeps } from '@/lib/share/api'
import { createGetShareImageHandler } from '@/lib/share/handlers/media'

export const runtime = 'nodejs'
// 卡片内容会变（指纹 key），路由不能被静态化缓存
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    const deps = await getShareApiDeps()
    return await createGetShareImageHandler({ repo: deps.repo, getStore: deps.getStore })(req, ctx)
  } catch (err) {
    console.error('[api/share/img] GET failed', err)
    return new Response('Not found', { status: 404 })
  }
}
