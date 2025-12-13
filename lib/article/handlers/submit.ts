import { NextResponse } from 'next/server'
import { submit, type Actor } from '@/lib/article/workflow'
import type { ArticleApiDeps } from '@/lib/article/api'

export function createHandlers(deps: ArticleApiDeps) {
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

      const existing = await deps.repo.findById(id)
      if (!existing) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      const actor: Actor = { userId: session.user.id, isAdmin: Boolean(session.user.isAdmin) }
      const r = submit({ status: existing.status, authorId: existing.authorId, rejectReason: existing.rejectReason }, actor)
      if (!r.ok) {
        const status = r.error.code === 'FORBIDDEN' ? 403 : 409
        return NextResponse.json({ error: r.error.message }, { status })
      }

      if (await deps.mdxSlugExists(existing.slug)) {
        return NextResponse.json({ error: 'slug 与现有 MDX 文章冲突' }, { status: 409 })
      }

      const updated = await deps.repo.updateState(id, { status: 'in_review', rejectReason: null, publishedAt: null })
      if (!updated) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      return NextResponse.json({ ok: true, article: { id: updated.id, status: updated.status } })
    },
  }
}

