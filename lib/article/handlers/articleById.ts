import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ArticleSlugExistsError } from '@/lib/article/repo'
import { canEdit, type Actor } from '@/lib/article/workflow'
import type { ArticleApiDeps } from '@/lib/article/api'
import { renderRichTextEmbeds } from '@/lib/richtext/embeds'

const patchSchema = z
  .object({
    title: z.string().min(1).refine((v) => v.trim().length > 0, { message: '标题不能为空' }).optional(),
    seoTitle: z.string().max(120).nullable().optional(),
    description: z.string().max(320).nullable().optional(),
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

function arrayShallowEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function hasMeaningfulEdit(
  existing: any,
  update: {
    title?: string
    seoTitle?: string | null
    description?: string | null
    contentHtml?: string
    animeIds?: unknown
    city?: unknown
    routeLength?: unknown
    tags?: unknown
    cover?: unknown
  }
): boolean {
  if (update.title !== undefined && update.title !== existing.title) return true
  if (update.seoTitle !== undefined && update.seoTitle !== existing.seoTitle) return true
  if (update.description !== undefined && update.description !== existing.description) return true
  if (update.contentHtml !== undefined && update.contentHtml !== existing.contentHtml) return true
  if (update.animeIds !== undefined && !arrayShallowEqual(update.animeIds, existing.animeIds)) return true
  if (update.tags !== undefined && !arrayShallowEqual(update.tags, existing.tags)) return true
  if (update.city !== undefined && update.city !== existing.city) return true
  if (update.routeLength !== undefined && update.routeLength !== existing.routeLength) return true
  if (update.cover !== undefined && update.cover !== existing.cover) return true
  return false
}

function toDetail(a: any, sanitizeHtml: (html: string) => string) {
  const sanitized = sanitizeHtml(String(a.contentHtml || ''))
  const rendered = renderRichTextEmbeds(sanitized, a.contentJson)
  return {
    id: a.id,
    authorId: a.authorId,
    slug: a.slug,
    title: a.title,
    seoTitle: a.seoTitle ?? null,
    description: a.description ?? null,
    animeIds: a.animeIds,
    city: a.city,
    routeLength: a.routeLength,
    tags: a.tags,
    cover: a.cover ?? null,
    contentJson: a.contentJson,
    contentHtml: rendered,
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

      return NextResponse.json({ ok: true, article: toDetail(found, deps.sanitizeHtml) })
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
      if (body && typeof body === 'object' && 'slug' in (body as any)) {
        return NextResponse.json({ error: 'slug 不允许修改' }, { status: 400 })
      }
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

      const nextSeoTitle =
        parsed.data.seoTitle !== undefined ? (parsed.data.seoTitle == null ? null : parsed.data.seoTitle.trim() || null) : undefined
      if (nextSeoTitle !== undefined) {
        updateInput.seoTitle = nextSeoTitle
      }

      const nextDescription =
        parsed.data.description !== undefined ? (parsed.data.description == null ? null : parsed.data.description.trim() || null) : undefined
      if (nextDescription !== undefined) {
        updateInput.description = nextDescription
      }

      const nextCover = parsed.data.cover !== undefined ? (parsed.data.cover == null ? null : parsed.data.cover.trim() || null) : undefined
      if (nextCover !== undefined) {
        updateInput.cover = nextCover
      }

      const edited = hasMeaningfulEdit(existing, {
        title: nextTitle,
        seoTitle: nextSeoTitle,
        description: nextDescription,
        contentHtml: updateInput.contentHtml,
        animeIds: parsed.data.animeIds,
        city: parsed.data.city,
        routeLength: parsed.data.routeLength,
        tags: parsed.data.tags,
        cover: nextCover,
      })
      if (existing.status === 'rejected' && existing.needsRevision && edited) {
        updateInput.needsRevision = false
      }

      try {
        const updated = await deps.repo.updateDraft(id, updateInput)
        if (!updated) return NextResponse.json({ error: '未找到文章' }, { status: 404 })
        return NextResponse.json({ ok: true, article: toDetail(updated, deps.sanitizeHtml) })
      } catch (err) {
        if (err instanceof ArticleSlugExistsError) {
          return NextResponse.json({ error: 'slug 已存在' }, { status: 409 })
        }
        throw err
      }
    },

    async DELETE(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
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
        return NextResponse.json({ error: '当前状态不可删除' }, { status: 409 })
      }

      const deleted = await deps.repo.delete(id)
      if (!deleted) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      return NextResponse.json({ ok: true })
    },
  }
}
