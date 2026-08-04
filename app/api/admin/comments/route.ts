import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCommentApiDeps } from '@/lib/comment/api'
import { createHandlers } from '@/lib/comment/handlers/commentModeration'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const session = await getServerAuthSession()
    const result = await createHandlers(getCommentApiDeps()).list(session)
    if (!result.ok) {
      const status = result.error === '无权限' ? 403 : 500
      return NextResponse.json({ error: result.error }, { status })
    }
    return NextResponse.json({ ok: true, comments: result.comments })
  } catch (err) {
    console.error('[api/admin/comments] GET failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
