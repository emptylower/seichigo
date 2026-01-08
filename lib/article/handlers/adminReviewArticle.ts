import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ArticleSlugExistsError } from '@/lib/article/repo'
import type { ArticleApiDeps } from '@/lib/article/api'

const patchSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(128)
      .refine((v) => v.trim().length > 0, { message: 'slug 不能为空' })
      .refine((v) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.trim()), { message: 'slug 格式无效' }),
  })
  .strict()

export function createHandlers(deps: ArticleApiDeps) {
  return {
    async PATCH(req: Request, ctx: { params?: Promise<{ id: string }> }) {
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

      const existing = await deps.repo.findById(id)
      if (!existing) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      if (existing.status !== 'in_review') {
        return NextResponse.json({ error: '当前状态不可修改 slug' }, { status: 409 })
      }

      const body = await req.json().catch(() => null)
      const parsed = patchSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const nextSlug = parsed.data.slug.trim()
      const conflictMdx = await deps.mdxSlugExists(nextSlug).catch(() => false)
      if (conflictMdx) {
        return NextResponse.json({ error: 'slug 已存在' }, { status: 409 })
      }

      try {
        const updated = await deps.repo.updateDraft(id, { slug: nextSlug })
        if (!updated) return NextResponse.json({ error: '未找到文章' }, { status: 404 })
        return NextResponse.json({ ok: true, article: { id: updated.id, slug: updated.slug } })
      } catch (err) {
        if (err instanceof ArticleSlugExistsError) {
          return NextResponse.json({ error: 'slug 已存在' }, { status: 409 })
        }
        throw err
      }
    },
  }
}

