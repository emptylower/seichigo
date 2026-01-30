import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCommentApiDeps } from '@/lib/comment/api'
import { createHandlers } from '@/lib/comment/handlers/comments'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const deps = getCommentApiDeps()
    const handlers = createHandlers(deps)

    const { searchParams } = new URL(req.url)
    const articleId = searchParams.get('articleId') || undefined
    const mdxSlug = searchParams.get('mdxSlug') || undefined

    const result = await handlers.list({ articleId, mdxSlug })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ ok: true, comments: result.comments })
  } catch (err) {
    console.error('[api/comments] GET failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    const deps = getCommentApiDeps()
    const handlers = createHandlers(deps)

    const body = await req.json()
    const result = await handlers.create(session, body)

    if (!result.ok) {
      const status = result.error === '请先登录' ? 401 : 400
      return NextResponse.json({ error: result.error }, { status })
    }

    return NextResponse.json({ ok: true, comment: result.comment }, { status: 201 })
  } catch (err) {
    console.error('[api/comments] POST failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
