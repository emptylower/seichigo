import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCommentApiDeps } from '@/lib/comment/api'
import { createHandlers } from '@/lib/comment/handlers/commentModeration'

export const runtime = 'nodejs'

function readAction(body: unknown): unknown {
  if (!body || typeof body !== 'object' || !('action' in body)) return undefined
  return body.action
}

function statusFor(error: string): number {
  if (error === '无权限') return 403
  if (error === '评论不存在') return 404
  if (error === '操作无效') return 400
  return 500
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerAuthSession()
    const body = await req.json().catch(() => ({}))
    const { id } = await ctx.params
    const result = await createHandlers(getCommentApiDeps()).update(session, id, readAction(body))
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusFor(result.error) })
    return NextResponse.json({ ok: true, comment: result.comment })
  } catch (err) {
    console.error('[api/admin/comments/[id]] PATCH failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerAuthSession()
    const { id } = await ctx.params
    const result = await createHandlers(getCommentApiDeps()).remove(session, id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusFor(result.error) })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/admin/comments/[id]] DELETE failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
