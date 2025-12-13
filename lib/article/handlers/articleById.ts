import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ArticleSlugExistsError } from '@/lib/article/repo'
import { canEdit, type Actor } from '@/lib/article/workflow'
import type { ArticleApiDeps } from '@/lib/article/api'

const patchSchema = z
  .object({
    slug: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    animeId: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    routeLength: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    contentJson: z.unknown().nullable().optional(),
    contentHtml: z.string().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少需要更新一个字段' })

function toDetail(a: any) {
  return {
    id: a.id,
    authorId: a.authorId,
    slug: a.slug,
    title: a.title,
    animeId: a.animeId,
    city: a.city,
    routeLength: a.routeLength,
    tags: a.tags,
    contentJson: a.contentJson,
    contentHtml: a.contentHtml,
    status: a.status,
    rejectReason: a.rejectReason,
    publishedAt: a.publishedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

export function createHandlers(deps: ArticleApiDeps) {
  return {
    async GET(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const found = await deps.repo.findById(id)
      if (!found) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      const actor: Actor = { userId: session.user.id, isAdmin: Boolean(session.user.isAdmin) }
      if (!actor.isAdmin && found.authorId !== actor.userId) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      return NextResponse.json({ ok: true, article: toDetail(found) })
    },

    async PATCH(req: Request, ctx: { params?: Promise<{ id: string }> }) {
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
      if (existing.authorId !== actor.userId) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }
      if (!canEdit({ status: existing.status, authorId: existing.authorId, rejectReason: existing.rejectReason }, actor)) {
        return NextResponse.json({ error: '当前状态不可编辑' }, { status: 409 })
      }

      const body = await req.json().catch(() => null)
      const parsed = patchSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      if (parsed.data.slug != null) {
        const nextSlug = parsed.data.slug.trim()
        if (!nextSlug) {
          return NextResponse.json({ error: 'slug 不能为空' }, { status: 400 })
        }
        if (await deps.mdxSlugExists(nextSlug)) {
          return NextResponse.json({ error: 'slug 与现有 MDX 文章冲突' }, { status: 409 })
        }
        parsed.data.slug = nextSlug
      }

      const updateInput: Record<string, any> = { ...parsed.data }
      if (parsed.data.contentHtml !== undefined) {
        updateInput.contentHtml = deps.sanitizeHtml(parsed.data.contentHtml)
      }

      try {
        const updated = await deps.repo.updateDraft(id, updateInput)
        if (!updated) {
          return NextResponse.json({ error: '未找到文章' }, { status: 404 })
        }
        return NextResponse.json({ ok: true, article: toDetail(updated) })
      } catch (err) {
        if (err instanceof ArticleSlugExistsError) {
          return NextResponse.json({ error: 'slug 已存在' }, { status: 409 })
        }
        throw err
      }
    },
  }
}

