import { NextResponse } from 'next/server'

import { getServerAuthSession } from '@/lib/auth/session'
import { PrismaArticleRepo } from '@/lib/article/repoPrisma'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'

export const runtime = 'nodejs'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }
  if (!session.user.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const repo = new PrismaArticleRepo()
  const article = await repo.findById(id)
  if (!article) return NextResponse.json({ error: '未找到文章' }, { status: 404 })

  const nextHtml = renderArticleContentHtmlFromJson(article.contentJson)

  const updated = await repo.updateDraft(id, { contentHtml: nextHtml })
  if (!updated) return NextResponse.json({ error: '未找到文章' }, { status: 404 })

  return NextResponse.json({ ok: true, id: updated.id, status: updated.status })
}
