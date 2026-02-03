import { NextResponse } from 'next/server'
import type { AiApiDeps } from '@/lib/ai/api'

export function createHandlers(deps: AiApiDeps) {
  return {
    async POST(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      if (!deps.isAdminEmail(session.user.email)) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const existing = await deps.repo.findById(id)
      if (!existing) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      if (existing.status !== 'draft' && existing.status !== 'rejected') {
        return NextResponse.json({ error: '只能提交草稿或已拒绝的文章' }, { status: 409 })
      }

      const updated = await deps.repo.updateState(id, { status: 'in_review', rejectReason: null })
      if (!updated) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      return NextResponse.json({ ok: true, article: { id: updated.id, status: updated.status, authorId: updated.authorId } })
    },
  }
}
