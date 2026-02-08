import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'

type ReviewQueueStatus = 'in_review' | 'published'

function clampInt(value: string | null, fallback: number, opts?: { min?: number; max?: number }): number {
  const min = opts?.min ?? 1
  const max = opts?.max ?? 100
  const raw = value ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

function parseStatus(value: string | null): ReviewQueueStatus {
  return value === 'published' ? 'published' : 'in_review'
}

type QueueItem = {
  id: string
  kind: 'article' | 'revision'
  articleId: string | null
  title: string
  slug: string | null
  status: string
  updatedAt: string
}

export async function GET(req: Request) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = parseStatus(searchParams.get('status'))
    const page = clampInt(searchParams.get('page'), 1, { min: 1, max: 10_000 })
    const pageSize = clampInt(searchParams.get('pageSize'), 20, { min: 5, max: 100 })
    const offset = (page - 1) * pageSize

    if (status === 'published') {
      const [rows, total] = await Promise.all([
        prisma.article.findMany({
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
        prisma.article.count({ where: { status: 'published' } }),
      ])

      return NextResponse.json({
        ok: true,
        status,
        page,
        pageSize,
        total,
        items: rows.map((row): QueueItem => ({
          id: row.id,
          kind: 'article',
          articleId: row.id,
          title: row.title,
          slug: row.slug,
          status: row.status,
          updatedAt: row.updatedAt.toISOString(),
        })),
      })
    }

    const fetchTake = offset + pageSize

    const [articleTotal, revisionTotal, articles, revisions] = await Promise.all([
      prisma.article.count({ where: { status: 'in_review' } }),
      prisma.articleRevision.count({ where: { status: 'in_review' } }),
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
        take: fetchTake,
      }),
      prisma.articleRevision.findMany({
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
  } catch (err) {
    console.error('[api/admin/review/queue] GET failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
