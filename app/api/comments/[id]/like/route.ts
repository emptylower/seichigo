import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCommentApiDeps } from '@/lib/comment/api'
import { createHandlers } from '@/lib/comment/handlers/commentLike'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerAuthSession()
    const deps = getCommentApiDeps()
    const handlers = createHandlers(deps)
    
    const { id } = await ctx.params
    const result = await handlers.toggle(session, id)
    
    if (!result.ok) {
      const status = result.error === '请先登录' ? 401 : 500
      return NextResponse.json({ error: result.error }, { status })
    }
    
    return NextResponse.json({ ok: true, liked: result.liked, count: result.count })
  } catch (err) {
    console.error('[api/comments/[id]/like] POST failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
