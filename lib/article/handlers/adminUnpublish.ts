import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { unpublish } from '@/lib/article/workflow'
import type { ArticleApiDeps } from '@/lib/article/api'

const schema = z.object({
  reason: z.string().min(1),
})

export function createHandlers(deps: ArticleApiDeps) {
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

      const existing = await deps.repo.findById(id)
      if (!existing) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      const r = unpublish(
        { status: existing.status, authorId: existing.authorId, rejectReason: existing.rejectReason },
        { userId: session.user.id, isAdmin: true },
        parsed.data.reason
      )
      if (!r.ok) {
        return NextResponse.json({ error: r.error.message }, { status: 409 })
      }

      const updated = await deps.repo.updateState(id, {
        status: 'rejected',
        rejectReason: parsed.data.reason.trim(),
        needsRevision: true,
      })
      if (!updated) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      // Revalidate homepage caches for all locales
      revalidatePath('/')
      revalidatePath('/en')
      revalidatePath('/ja')
      // Revalidate article detail pages
      const slug = existing.slug
      revalidatePath(`/posts/${slug}`)
      revalidatePath(`/en/posts/${slug}`)
      revalidatePath(`/ja/posts/${slug}`)

      return NextResponse.json({ ok: true, article: { id: updated.id, status: updated.status, rejectReason: updated.rejectReason } })
    },
  }
}

