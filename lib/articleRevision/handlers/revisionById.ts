import { NextResponse } from 'next/server'
import { z } from 'zod'
import { canEditRevision, type Actor } from '@/lib/articleRevision/workflow'
import type { ArticleRevisionApiDeps } from '@/lib/articleRevision/api'

const patchSchema = z
  .object({
    title: z.string().min(1).refine((v) => v.trim().length > 0, { message: '标题不能为空' }).optional(),
    animeIds: z.array(z.string()).optional(),
    city: z.string().nullable().optional(),
    routeLength: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    cover: z
      .string()
      .max(512)
      .nullable()
      .optional()
      .refine((v) => v == null || /^\/assets\/[a-zA-Z0-9_-]+$/.test(v), { message: '封面地址无效' }),
    contentJson: z.unknown().nullable().optional(),
    contentHtml: z.string().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少需要更新一个字段' })

function toDetail(r: any, sanitizeHtml: (html: string) => string) {
  return {
    id: r.id,
    articleId: r.articleId,
    authorId: r.authorId,
    title: r.title,
    animeIds: r.animeIds,
    city: r.city,
    routeLength: r.routeLength,
    tags: r.tags,
    cover: r.cover ?? null,
    contentJson: r.contentJson,
    contentHtml: sanitizeHtml(String(r.contentHtml || '')),
    status: r.status,
    rejectReason: r.rejectReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function createHandlers(deps: ArticleRevisionApiDeps) {
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

      const found = await deps.revisionRepo.findById(id)
      if (!found) {
        return NextResponse.json({ error: '未找到更新稿' }, { status: 404 })
      }

      if (!session.user.isAdmin && found.authorId !== session.user.id) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      return NextResponse.json({ ok: true, revision: toDetail(found, deps.sanitizeHtml) })
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

      const existing = await deps.revisionRepo.findById(id)
      if (!existing) {
        return NextResponse.json({ error: '未找到更新稿' }, { status: 404 })
      }

      const actor: Actor = { userId: session.user.id, isAdmin: Boolean(session.user.isAdmin) }
      if (existing.authorId !== actor.userId) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }
      if (actor.isAdmin) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }
      if (!canEditRevision({ status: existing.status, authorId: existing.authorId, rejectReason: existing.rejectReason }, actor)) {
        return NextResponse.json({ error: '当前状态不可编辑' }, { status: 409 })
      }

      const body = await req.json().catch(() => null)
      const parsed = patchSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const updateInput: Record<string, any> = { ...parsed.data }
      if (parsed.data.contentHtml !== undefined) {
        updateInput.contentHtml = deps.sanitizeHtml(parsed.data.contentHtml)
      }

      const nextTitle = parsed.data.title != null ? parsed.data.title.trim() : undefined
      if (nextTitle !== undefined) {
        updateInput.title = nextTitle
      }

      const nextCover = parsed.data.cover !== undefined ? (parsed.data.cover == null ? null : parsed.data.cover.trim() || null) : undefined
      if (nextCover !== undefined) {
        updateInput.cover = nextCover
      }

      const updated = await deps.revisionRepo.updateDraft(id, updateInput)
      if (!updated) {
        return NextResponse.json({ error: '未找到更新稿' }, { status: 404 })
      }

      return NextResponse.json({ ok: true, revision: toDetail(updated, deps.sanitizeHtml) })
    },
  }
}

