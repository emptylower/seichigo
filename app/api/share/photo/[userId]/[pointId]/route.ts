import { getShareApiDeps } from '@/lib/share/api'
import { createGetCheckinPhotoHandler } from '@/lib/share/handlers/media'

export const runtime = 'nodejs'
// 实拍图可被同名覆盖重传，保持每次回源
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ userId: string; pointId: string }> }) {
  try {
    const deps = await getShareApiDeps()
    return await createGetCheckinPhotoHandler({ getStore: deps.getStore })(req, ctx)
  } catch (err) {
    console.error('[api/share/photo] GET failed', err)
    return new Response('Not found', { status: 404 })
  }
}
