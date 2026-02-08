import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'

type QueueItem = {
  id: string
  kind: 'article' | 'revision'
  title: string
  slug: string | null
  status: string
  updatedAt: string
  href: string
}

export async function GET() {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
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
      prisma.article.count({ where: { status: 'in_review' } }),
      prisma.articleRevision.count({ where: { status: 'in_review' } }),
      prisma.translationTask.count({ where: { status: 'ready' } }),
      prisma.article.count({ where: { status: 'published' } }),
      prisma.anime.count({ where: { hidden: false } }),
      prisma.city.count({ where: { hidden: false } }),
      prisma.user.count(),
      prisma.waitlistEntry.count(),
      prisma.article.findMany({
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
      prisma.articleRevision.findMany({
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
  } catch (err) {
    console.error('[api/admin/dashboard/summary] GET failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
