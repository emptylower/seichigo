import { NextResponse } from 'next/server'
import type { AdminApiDeps } from '@/lib/admin/api'
import { clampInt, isAdminSession } from '@/lib/admin/handlers/common'

type ReviewQueueStatus = 'in_review' | 'published'

type QueueItem = {
  id: string
  kind: 'article' | 'revision'
  articleId: string | null
  title: string
  slug: string | null
  status: string
  updatedAt: string
}

function parseStatus(value: string | null): ReviewQueueStatus {
  return value === 'published' ? 'published' : 'in_review'
}

export function createHandlers(deps: AdminApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const { searchParams } = new URL(req.url)
      const status = parseStatus(searchParams.get('status'))
      const page = clampInt(searchParams.get('page'), 1, { min: 1, max: 10_000 })
      const pageSize = clampInt(searchParams.get('pageSize'), 20, { min: 5, max: 100 })
      const offset = (page - 1) * pageSize

      if (status === 'published') {
        const [rows, total] = await Promise.all([
          deps.prisma.article.findMany({
            where: { status: 'published' },
            select: {
              id: true,
              slug: true,
              title: true,
              status: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: 'desc' },
            skip: offset,
            take: pageSize,
          }),
          deps.prisma.article.count({ where: { status: 'published' } }),
        ])

        return NextResponse.json({
          ok: true,
          status,
          page,
          pageSize,
          total,
          items: rows.map(
            (row): QueueItem => ({
              id: row.id,
              kind: 'article',
              articleId: row.id,
              title: row.title,
              slug: row.slug,
              status: row.status,
              updatedAt: row.updatedAt.toISOString(),
            })
          ),
        })
      }

      const fetchTake = offset + pageSize

      const [articleTotal, revisionTotal, articles, revisions] = await Promise.all([
        deps.prisma.article.count({ where: { status: 'in_review' } }),
        deps.prisma.articleRevision.count({ where: { status: 'in_review' } }),
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
          take: fetchTake,
        }),
        deps.prisma.articleRevision.findMany({
          where: { status: 'in_review' },
          select: {
            id: true,
            articleId: true,
            title: true,
            status: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: fetchTake,
        }),
      ])

      const merged: QueueItem[] = [
        ...articles.map((row) => ({
          id: row.id,
          kind: 'article' as const,
          articleId: row.id,
          title: row.title,
          slug: row.slug,
          status: row.status,
          updatedAt: row.updatedAt.toISOString(),
        })),
        ...revisions.map((row) => ({
          id: row.id,
          kind: 'revision' as const,
          articleId: row.articleId,
          title: row.title,
          slug: null,
          status: row.status,
          updatedAt: row.updatedAt.toISOString(),
        })),
      ].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

      const total = articleTotal + revisionTotal
      const items = merged.slice(offset, offset + pageSize)

      return NextResponse.json({
        ok: true,
        status,
        page,
        pageSize,
        total,
        items,
      })
    },
  }
}
