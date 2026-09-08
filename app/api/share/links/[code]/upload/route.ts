import { NextResponse } from 'next/server'
import { getShareApiDeps } from '@/lib/share/api'
import { createPostShareUploadHandler } from '@/lib/share/handlers/upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    const deps = await getShareApiDeps()
    return await createPostShareUploadHandler(deps)(req, ctx)
  } catch (err) {
    console.error('[api/share/links/upload] POST failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
