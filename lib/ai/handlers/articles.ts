import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ArticleSlugExistsError } from '@/lib/article/repo'
import type { AiApiDeps } from '@/lib/ai/api'
import type { ArticleStatus } from '@/lib/article/workflow'
import { generateSlugFromTitle } from '@/lib/article/slug'

const createSchema = z.object({
  title: z.string().min(1).refine((v) => v.trim().length > 0, { message: '标题不能为空' }),
  seoTitle: z.string().max(120).nullable().optional(),
  description: z.string().max(320).nullable().optional(),
  language: z.string().min(2).max(10).optional(),
  translationGroupId: z.string().nullable().optional(),
  animeIds: z.array(z.string()).optional(),
  city: z.string().nullable().optional(),
  routeLength: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  contentJson: z.unknown().nullable().optional(),
  contentHtml: z.string().optional(),
})

function toListItem(a: any) {
  return {
    id: a.id,
    slug: a.slug,
    language: a.language ?? 'zh',
    translationGroupId: a.translationGroupId ?? null,
    authorId: a.authorId,
    title: a.title,
    seoTitle: a.seoTitle ?? null,
    description: a.description ?? null,
    animeIds: a.animeIds,
    city: a.city,
    routeLength: a.routeLength,
    tags: a.tags,
    status: a.status,
    rejectReason: a.rejectReason,
    publishedAt: a.publishedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

export function createHandlers(deps: AiApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      if (!deps.isAdminEmail(session.user.email)) {
        return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
      }

      const url = new URL(req.url)
      const authorId = url.searchParams.get('authorId') || undefined
      const status = (url.searchParams.get('status') as ArticleStatus | null) || undefined
      const language = url.searchParams.get('language') || undefined

      let articles

      if (authorId) {
        const byAuthor = await deps.repo.listByAuthor(authorId)
        articles = byAuthor
          .filter((a) => !status || a.status === status)
          .filter((a) => !language || (a.language ?? 'zh') === language)
      } else if (status) {
        const byStatus = await deps.repo.listByStatus(status)
        articles = language ? byStatus.filter((a) => (a.language ?? 'zh') === language) : byStatus
      } else {
        const allStatuses: ArticleStatus[] = ['draft', 'in_review', 'published', 'rejected']
        const allArticles = await Promise.all(allStatuses.map((s) => deps.repo.listByStatus(s)))
        const merged = allArticles.flat()
        articles = language ? merged.filter((a) => (a.language ?? 'zh') === language) : merged
      }

      return NextResponse.json({ ok: true, items: articles.map(toListItem) })
    },

    async POST(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id || !session?.user?.email) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      if (!deps.isAdminEmail(session.user.email)) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const body = await req.json().catch(() => null)
      const parsed = createSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const baseSlug = generateSlugFromTitle(parsed.data.title, new Date())
      const contentHtml = parsed.data.contentHtml ? deps.sanitizeHtml(parsed.data.contentHtml) : ''
      const seoTitle = parsed.data.seoTitle == null ? null : parsed.data.seoTitle.trim() || null
      const description = parsed.data.description == null ? null : parsed.data.description.trim() || null

      const maxAttempts = 20
      for (let i = 0; i < maxAttempts; i++) {
        const suffix = i === 0 ? '' : `-${i + 1}`
        const candidate = `${baseSlug}${suffix}`
        try {
          const created = await deps.repo.createDraft({
            authorId: session.user.id,
            slug: candidate,
            language: parsed.data.language ?? 'zh',
            translationGroupId: parsed.data.translationGroupId ?? null,
            title: parsed.data.title,
            seoTitle,
            description,
            animeIds: parsed.data.animeIds,
            city: parsed.data.city,
            routeLength: parsed.data.routeLength,
            tags: parsed.data.tags,
            contentJson: parsed.data.contentJson ?? null,
            contentHtml,
          })
          return NextResponse.json({ ok: true, article: toListItem(created) })
        } catch (err) {
          if (err instanceof ArticleSlugExistsError) continue
          throw err
        }
      }

      return NextResponse.json({ error: '无法生成唯一 slug，请稍后重试' }, { status: 409 })
    },
  }
}
