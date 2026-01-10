import { NextResponse } from 'next/server'
import { withdrawRevision, type Actor } from '@/lib/articleRevision/workflow'
import type { ArticleRevisionApiDeps } from '@/lib/articleRevision/api'

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

      const actor: Actor = { userId: session.user.id, isAdmin: Boolean(session.user.isAdmin) }
      const r = withdrawRevision({ status: existing.status, authorId: existing.authorId, rejectReason: existing.rejectReason }, actor)
      if (!r.ok) {
        const status = r.error.code === 'FORBIDDEN' ? 403 : 409
        return NextResponse.json({ error: r.error.message }, { status })
      }

      const updated = await deps.revisionRepo.updateState(id, { status: 'draft' })
      if (!updated) {
        return NextResponse.json({ error: '未找到更新稿' }, { status: 404 })
      }

      return NextResponse.json({ ok: true, revision: { id: updated.id, status: updated.status } })
    },
  }
}

