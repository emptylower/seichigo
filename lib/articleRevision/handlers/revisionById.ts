import { NextResponse } from 'next/server'
import { z } from 'zod'
import { canEditRevision, type Actor } from '@/lib/articleRevision/workflow'
import type { ArticleRevisionApiDeps } from '@/lib/articleRevision/api'
import { getRevisionCityIds, setRevisionCityIds } from '@/lib/city/links'
import { listCitiesByIds } from '@/lib/city/listByIds'

const patchSchema = z
  .object({
    title: z.string().min(1).refine((v) => v.trim().length > 0, { message: '标题不能为空' }).optional(),
    seoTitle: z.string().max(120).nullable().optional(),
    description: z.string().max(320).nullable().optional(),
    animeIds: z.array(z.string()).optional(),
    city: z.string().nullable().optional(),
    cityIds: z.array(z.string()).optional(),
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
    seoTitle: r.seoTitle ?? null,
    description: r.description ?? null,
    animeIds: r.animeIds,
    city: r.city,
    cityIds: [],
    cities: [],
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

      const base = toDetail(found, deps.sanitizeHtml)
      const cityIds = await getRevisionCityIds(found.id).catch(() => [])
      const cities = await listCitiesByIds(cityIds).catch(() => [])
      return NextResponse.json({ ok: true, revision: { ...base, cityIds, cities } })
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
      if (!canEditRevision({ status: existing.status, authorId: existing.authorId, rejectReason: existing.rejectReason }, actor)) {
        return NextResponse.json({ error: '当前状态不可编辑' }, { status: 409 })
      }

      const body = await req.json().catch(() => null)
      const parsed = patchSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const updateInput: Record<string, any> = { ...parsed.data }
      const nextCityIds = Array.isArray(parsed.data.cityIds)
        ? parsed.data.cityIds.map((x) => String(x || '').trim()).filter(Boolean)
        : null
      if (nextCityIds != null) {
        delete updateInput.cityIds
        const cities = await listCitiesByIds(nextCityIds).catch(() => [])
        const primary = cities[0] || null
        updateInput.city = primary?.name_zh ? String(primary.name_zh).trim() : null
      }
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

      const updated = await deps.revisionRepo.updateDraft(id, updateInput)
      if (!updated) {
        return NextResponse.json({ error: '未找到更新稿' }, { status: 404 })
      }

      if (nextCityIds != null) {
        await setRevisionCityIds(id, nextCityIds).catch(() => null)
      }

      const base = toDetail(updated, deps.sanitizeHtml)
      const cityIds = await getRevisionCityIds(updated.id).catch(() => [])
      const cities = await listCitiesByIds(cityIds).catch(() => [])
      return NextResponse.json({ ok: true, revision: { ...base, cityIds, cities } })
    },
  }
}
