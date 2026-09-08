import { NextResponse } from 'next/server'
import { getShareApiDeps } from '@/lib/share/api'
import { createPostShareLinkHandler } from '@/lib/share/handlers/links'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const deps = await getShareApiDeps()
    return await createPostShareLinkHandler(deps)(req)
  } catch (err) {
    console.error('[api/share/links] POST failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
