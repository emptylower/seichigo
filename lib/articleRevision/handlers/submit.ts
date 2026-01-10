import { NextResponse } from 'next/server'
import { submitRevision, type Actor } from '@/lib/articleRevision/workflow'
import type { ArticleRevisionApiDeps } from '@/lib/articleRevision/api'

function countPlainText(html: string): number {
  if (!html) return 0
  const withoutTags = html.replace(/<[^>]*>/g, ' ')
  const collapsed = withoutTags.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
  return collapsed.length
}

export function createHandlers(deps: ArticleRevisionApiDeps) {
  return {
    async POST(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const existing = await deps.revisionRepo.findById(id)
      if (!existing) {
        return NextResponse.json({ error: '未找到更新稿' }, { status: 404 })
      }

      const article = await deps.articleRepo.findById(existing.articleId)
      if (!article) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }
      if (article.status !== 'published') {
        return NextResponse.json({ error: '当前文章未发布，无法提交更新审核' }, { status: 409 })
      }

      const actor: Actor = { userId: session.user.id, isAdmin: Boolean(session.user.isAdmin) }
      const r = submitRevision({ status: existing.status, authorId: existing.authorId, rejectReason: existing.rejectReason }, actor)
      if (!r.ok) {
        const status = r.error.code === 'FORBIDDEN' ? 403 : 409
        return NextResponse.json({ error: r.error.message }, { status })
      }

      const title = String(existing.title || '').trim()
      if (!title || title === '未命名') {
        return NextResponse.json({ error: '请先填写标题' }, { status: 400 })
      }

      const animeIds = Array.isArray((existing as any).animeIds)
        ? (existing as any).animeIds.map((x: any) => String(x || '').trim()).filter(Boolean)
        : []
      if (!animeIds.length) {
        return NextResponse.json({ error: '请至少选择一个作品' }, { status: 400 })
      }

      const bodyLen = countPlainText(String(existing.contentHtml || ''))
      if (bodyLen <= 100) {
        return NextResponse.json({ error: '正文内容至少需要 100 字' }, { status: 400 })
      }

      const updated = await deps.revisionRepo.updateState(id, { status: 'in_review', rejectReason: null })
      if (!updated) {
        return NextResponse.json({ error: '未找到更新稿' }, { status: 404 })
      }

      return NextResponse.json({ ok: true, revision: { id: updated.id, status: updated.status } })
    },
  }
}

