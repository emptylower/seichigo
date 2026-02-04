import { NextResponse } from 'next/server'
import { approve } from '@/lib/article/workflow'
import type { ArticleApiDeps } from '@/lib/article/api'
import { isFallbackHashSlug, isValidArticleSlug } from '@/lib/article/slug'
import { getArticleCityIds, setArticleCityIds } from '@/lib/city/links'
import { resolveCitiesByNames } from '@/lib/city/resolve'
import { safeRevalidatePath } from '@/lib/next/revalidate'

function hasAnimePrefix(slug: string, animeIds: string[]): boolean {
  const cleaned = slug.trim()
  if (!cleaned) return false
  const prefixes = animeIds.map((id) => `${id}-`).filter((x) => x.length > 1)
  return prefixes.some((p) => cleaned.startsWith(p) && cleaned.length > p.length)
}

export function createHandlers(deps: ArticleApiDeps) {
  return {
    async POST(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
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

      const slug = String((existing as any).slug || '').trim()
      if (!isValidArticleSlug(slug)) {
        return NextResponse.json({ error: 'slug 格式无效' }, { status: 400 })
      }
      if (isFallbackHashSlug(slug)) {
        return NextResponse.json({ error: 'slug 不够可读，请在发布前设置为“作品前缀-文章后缀”形式' }, { status: 400 })
      }

      const animeIds = Array.isArray((existing as any).animeIds)
        ? (existing as any).animeIds.map((x: any) => String(x || '').trim()).filter(Boolean)
        : []
      if (!animeIds.length) {
        return NextResponse.json({ error: '请至少选择一个作品' }, { status: 400 })
      }
      if (!hasAnimePrefix(slug, animeIds)) {
        return NextResponse.json({ error: `slug 必须以作品前缀开头（例如：${animeIds[0]}-xxx）` }, { status: 400 })
      }

      const conflictMdx = await deps.mdxSlugExists(slug).catch(() => false)
      if (conflictMdx) {
        return NextResponse.json({ error: 'slug 已存在' }, { status: 409 })
      }

      const r = approve({ status: existing.status, authorId: existing.authorId, rejectReason: existing.rejectReason }, { userId: session.user.id, isAdmin: true })
      if (!r.ok) {
        return NextResponse.json({ error: r.error.message }, { status: 409 })
      }

      const now = deps.now()
      const publishedAt = existing.publishedAt ?? now
      const updated = await deps.repo.updateState(id, {
        status: 'published',
        rejectReason: null,
        needsRevision: false,
        publishedAt,
        lastApprovedAt: now,
      })
      if (!updated) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      // Best-effort: ensure city links exist for city hubs.
      // Primary city for SEO stays on the legacy `city` string field.
      try {
        const linked = await getArticleCityIds(id)
        if (!linked.length) {
          const rawCity = String((existing as any).city || '').trim()
          if (rawCity) {
            const resolved = await resolveCitiesByNames([rawCity], { createIfMissing: true })
            const primary = resolved.cities[0] || null
            if (primary) {
              await setArticleCityIds(id, [primary.id])
              if (primary.name_zh && rawCity !== primary.name_zh) {
                await deps.repo.updateDraft(id, { city: primary.name_zh })
              }
            }
          }
        }
      } catch (err) {
        console.error('[article/adminApprove] city link sync failed', err)
      }

      // Auto-create translation tasks for published article
      try {
        const { prisma } = await import('@/lib/db/prisma')
        const targetLanguages = ['en', 'ja']
        
        await Promise.all(
          targetLanguages.map((targetLanguage) =>
            prisma.translationTask.upsert({
              where: {
                entityType_entityId_targetLanguage: {
                  entityType: 'article',
                  entityId: id,
                  targetLanguage,
                },
              },
              create: {
                entityType: 'article',
                entityId: id,
                targetLanguage,
                status: 'pending',
              },
              update: {},
            })
          )
        )
      } catch (err) {
        console.error('[article/adminApprove] translation task creation failed', err)
      }

      // Revalidate homepage caches for all locales
      safeRevalidatePath('/')
      safeRevalidatePath('/en')
      safeRevalidatePath('/ja')
      // Revalidate article detail pages
      safeRevalidatePath(`/posts/${existing.slug}`)
      safeRevalidatePath(`/en/posts/${existing.slug}`)
      safeRevalidatePath(`/ja/posts/${existing.slug}`)

      return NextResponse.json({ ok: true, article: { id: updated.id, status: updated.status, publishedAt: updated.publishedAt } })
    },
  }
}
