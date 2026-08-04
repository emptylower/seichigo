import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCommentApiDeps } from '@/lib/comment/api'
import { createHandlers } from '@/lib/comment/handlers/commentReport'

export const runtime = 'nodejs'

function readReason(body: unknown): unknown {
  if (!body || typeof body !== 'object' || !('reason' in body)) return undefined
  return body.reason
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerAuthSession()
    const body = await req.json().catch(() => ({}))
    const { id } = await ctx.params
    const result = await createHandlers(getCommentApiDeps()).report(session, id, readReason(body))

    if (!result.ok) {
      const status = result.error === '请先登录'
        ? 401
        : result.error === '评论不存在'
          ? 404
          : result.error === '你已经举报过该评论'
            ? 409
            : result.error === '举报原因无效'
              ? 400
              : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    return NextResponse.json({ ok: true, report: result.report }, { status: 201 })
  } catch (err) {
    console.error('[api/comments/[id]/report] POST failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
