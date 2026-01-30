import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCommentApiDeps } from '@/lib/comment/api'
import { createHandlers } from '@/lib/comment/handlers/commentById'

export const runtime = 'nodejs'

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerAuthSession()
    const deps = getCommentApiDeps()
    const handlers = createHandlers(deps)
    
    const { id } = await ctx.params
    const result = await handlers.remove(session, id)
    
    if (!result.ok) {
      let status = 500
      if (result.error === '请先登录') status = 401
      else if (result.error === '无权限') status = 403
      else if (result.error === '评论不存在') status = 404
      
      return NextResponse.json({ error: result.error }, { status })
    }
    
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/comments/[id]] DELETE failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
