import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AiApiDeps } from '@/lib/ai/api'
import { renderRichTextEmbeds } from '@/lib/richtext/embeds'
import { authorizeAiRequest } from '@/lib/ai/auth'

function toDetail(a: any, sanitizeHtml: (html: string) => string) {
  const sanitized = sanitizeHtml(String(a.contentHtml || ''))
  const rendered = renderRichTextEmbeds(sanitized, a.contentJson)
  return {
    id: a.id,
    authorId: a.authorId,
    slug: a.slug,
    language: a.language ?? 'zh',
    translationGroupId: a.translationGroupId ?? null,
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
    needsRevision: a.needsRevision,
    publishedAt: a.publishedAt,
    lastApprovedAt: a.lastApprovedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

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

export function createHandlers(deps: AiApiDeps) {
  return {
    async GET(req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const auth = await authorizeAiRequest(req, deps)
      if (!auth.ok) {
        const status = auth.reason === 'forbidden' ? 403 : 401
        const error = auth.reason === 'forbidden' ? '无权限' : '请先登录'
        return NextResponse.json({ error }, { status })
      }

      if (auth.mode === 'session' && !auth.session.user?.id) {
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

      const article = toDetail(found, deps.sanitizeHtml)
      return NextResponse.json({ ok: true, article })
    },

    async PATCH(req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const auth = await authorizeAiRequest(req, deps)
      if (!auth.ok) {
        const status = auth.reason === 'forbidden' ? 403 : 401
        const error = auth.reason === 'forbidden' ? '无权限' : '请先登录'
        return NextResponse.json({ error }, { status })
      }

      if (auth.mode === 'session' && !auth.session.user?.id) {
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

      if (existing.status !== 'draft' && existing.status !== 'rejected') {
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

      const updated = await deps.repo.updateDraft(id, updateInput)
      if (!updated) return NextResponse.json({ error: '未找到文章' }, { status: 404 })

      const article = toDetail(updated, deps.sanitizeHtml)
      return NextResponse.json({ ok: true, article })
    },
  }
}
