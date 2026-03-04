import { NextResponse } from 'next/server'
import type { AdminApiDeps } from '@/lib/admin/api'
import { isAdminSession } from '@/lib/admin/handlers/common'

type QueueItem = {
  id: string
  kind: 'article' | 'revision'
  title: string
  slug: string | null
  status: string
  updatedAt: string
  href: string
}

export function createHandlers(deps: AdminApiDeps) {
  return {
    async GET() {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const [
        pendingArticles,
        pendingRevisions,
        readyTranslations,
        publishedArticles,
        animeCount,
        cityCount,
        userCount,
        waitlistCount,
        recentArticles,
        recentRevisions,
      ] = await Promise.all([
        deps.prisma.article.count({ where: { status: 'in_review' } }),
        deps.prisma.articleRevision.count({ where: { status: 'in_review' } }),
        deps.prisma.translationTask.count({ where: { status: 'ready' } }),
        deps.prisma.article.count({ where: { status: 'published' } }),
        deps.prisma.anime.count({ where: { hidden: false } }),
        deps.prisma.city.count({ where: { hidden: false } }),
        deps.prisma.user.count(),
        deps.prisma.waitlistEntry.count(),
        deps.prisma.article.findMany({
          where: { status: 'in_review' },
          select: {
            id: true,
            slug: true,
            title: true,
            status: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        }),
        deps.prisma.articleRevision.findMany({
          where: { status: 'in_review' },
          select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        }),
      ])

      const queueItems: QueueItem[] = [
        ...recentArticles.map((item) => ({
          id: item.id,
          kind: 'article' as const,
          title: item.title,
          slug: item.slug,
          status: item.status,
          updatedAt: item.updatedAt.toISOString(),
          href: `/admin/review/${item.id}`,
        })),
        ...recentRevisions.map((item) => ({
          id: item.id,
          kind: 'revision' as const,
          title: item.title,
          slug: null,
          status: item.status,
          updatedAt: item.updatedAt.toISOString(),
          href: `/admin/review/${item.id}`,
        })),
      ]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, 20)

      return NextResponse.json({
        ok: true,
        stats: {
          pendingArticles,
          pendingRevisions,
          pendingReviewTotal: pendingArticles + pendingRevisions,
          readyTranslations,
          publishedArticles,
          animeCount,
          cityCount,
          userCount,
          waitlistCount,
        },
        queue: {
          total: pendingArticles + pendingRevisions,
          items: queueItems,
        },
      })
    },
  }
}
