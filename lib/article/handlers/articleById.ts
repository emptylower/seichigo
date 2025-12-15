import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ArticleSlugExistsError } from '@/lib/article/repo'
import { canEdit, type Actor } from '@/lib/article/workflow'
import type { ArticleApiDeps } from '@/lib/article/api'
import { generateSlugFromTitle } from '@/lib/article/slug'

const patchSchema = z
  .object({
    title: z.string().min(1).refine((v) => v.trim().length > 0, { message: '标题不能为空' }).optional(),
    animeIds: z.array(z.string()).optional(),
    city: z.string().nullable().optional(),
    routeLength: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
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

function hasMeaningfulEdit(existing: any, update: { title?: string; contentHtml?: string; animeIds?: unknown; city?: unknown; routeLength?: unknown; tags?: unknown }): boolean {
  if (update.title !== undefined && update.title !== existing.title) return true
  if (update.contentHtml !== undefined && update.contentHtml !== existing.contentHtml) return true
  if (update.animeIds !== undefined && !arrayShallowEqual(update.animeIds, existing.animeIds)) return true
  if (update.tags !== undefined && !arrayShallowEqual(update.tags, existing.tags)) return true
  if (update.city !== undefined && update.city !== existing.city) return true
  if (update.routeLength !== undefined && update.routeLength !== existing.routeLength) return true
  return false
}

function toDetail(a: any) {
  return {
    id: a.id,
    authorId: a.authorId,
    slug: a.slug,
    title: a.title,
    animeIds: a.animeIds,
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

      const edited = hasMeaningfulEdit(existing, {
        title: nextTitle,
        contentHtml: updateInput.contentHtml,
        animeIds: parsed.data.animeIds,
        city: parsed.data.city,
        routeLength: parsed.data.routeLength,
        tags: parsed.data.tags,
      })
      if (existing.status === 'rejected' && existing.needsRevision && edited) {
        updateInput.needsRevision = false
      }

      if (typeof nextTitle !== 'string' || nextTitle === existing.title) {
        try {
          const updated = await deps.repo.updateDraft(id, updateInput)
          if (!updated) return NextResponse.json({ error: '未找到文章' }, { status: 404 })
          return NextResponse.json({ ok: true, article: toDetail(updated) })
        } catch (err) {
          if (err instanceof ArticleSlugExistsError) {
            return NextResponse.json({ error: 'slug 已存在' }, { status: 409 })
          }
          throw err
        }
      }

      const baseSlug = generateSlugFromTitle(nextTitle, deps.now())
      const maxAttempts = 20
      for (let i = 0; i < maxAttempts; i++) {
        const suffix = i === 0 ? '' : `-${i + 1}`
        const candidate = `${baseSlug}${suffix}`
        try {
          const updated = await deps.repo.updateDraft(id, { ...updateInput, slug: candidate })
          if (!updated) return NextResponse.json({ error: '未找到文章' }, { status: 404 })
          return NextResponse.json({ ok: true, article: toDetail(updated) })
        } catch (err) {
          if (err instanceof ArticleSlugExistsError) continue
          throw err
        }
      }

      return NextResponse.json({ error: '无法生成唯一 slug，请稍后重试' }, { status: 409 })
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
