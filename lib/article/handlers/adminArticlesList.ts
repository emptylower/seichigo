import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Article } from '@/lib/article/repo'
import type { ArticleStatus } from '@/lib/article/workflow'
import type { ArticleApiDeps } from '@/lib/article/api'

const querySchema = z.object({
  authorId: z.string().min(1).optional(),
  status: z.enum(['draft', 'in_review', 'rejected', 'published']).optional(),
  language: z.string().min(2).max(10).optional(),
})

function toListItem(a: Article) {
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

export function createHandlers(deps: ArticleApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }
      if (!session.user.isAdmin) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const url = new URL(req.url)
      const parsed = querySchema.safeParse({
        authorId: url.searchParams.get('authorId') || undefined,
        status: url.searchParams.get('status') || undefined,
        language: url.searchParams.get('language') || undefined,
      })
      if (!parsed.success) {
        return NextResponse.json({ error: '参数错误' }, { status: 400 })
      }

      const status = parsed.data.status as ArticleStatus | undefined
      const language = parsed.data.language

      let articles
      if (parsed.data.authorId) {
        const byAuthor = await deps.repo.listByAuthor(parsed.data.authorId)
        articles = byAuthor
          .filter((a) => !status || a.status === status)
          .filter((a) => !language || (a.language ?? 'zh') === language)
      } else if (status) {
        articles = await deps.repo.listByStatus(status, language)
      } else {
        const allStatuses: ArticleStatus[] = ['draft', 'in_review', 'published', 'rejected']
        const allArticles = await Promise.all(allStatuses.map((s) => deps.repo.listByStatus(s, language)))
        articles = allArticles.flat()
      }

      return NextResponse.json({ ok: true, items: articles.map(toListItem) })
    },
  }
}
