import { NextResponse } from 'next/server'
import { z } from 'zod'
import { rejectRevision } from '@/lib/articleRevision/workflow'
import type { ArticleRevisionApiDeps } from '@/lib/articleRevision/api'

const schema = z.object({
  reason: z.string().min(1),
})

export function createHandlers(deps: ArticleRevisionApiDeps) {
  return {
    async POST(req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }
      if (!session.user.isAdmin) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const body = await req.json().catch(() => null)
      const parsed = schema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const revision = await deps.revisionRepo.findById(id)
      if (!revision) {
        return NextResponse.json({ error: '未找到更新稿' }, { status: 404 })
      }

      const r = rejectRevision(
        { status: revision.status, authorId: revision.authorId, rejectReason: revision.rejectReason },
        { userId: session.user.id, isAdmin: true },
        parsed.data.reason
      )
      if (!r.ok) {
        return NextResponse.json({ error: r.error.message }, { status: 409 })
      }

      const updated = await deps.revisionRepo.updateState(id, { status: 'rejected', rejectReason: parsed.data.reason.trim() })
      if (!updated) {
        return NextResponse.json({ error: '未找到更新稿' }, { status: 404 })
      }

      return NextResponse.json({ ok: true, revision: { id: updated.id, status: updated.status, rejectReason: updated.rejectReason } })
    },
  }
}

