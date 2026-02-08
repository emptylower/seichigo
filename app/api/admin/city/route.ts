import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { normalizeCityAlias } from '@/lib/city/normalize'
import { countPublishedArticlesByCityIds } from '@/lib/city/db'

export const runtime = 'nodejs'

function normalizeSearch(input: string): string {
  return normalizeCityAlias(String(input || ''))
}

function clampInt(value: string | null, fallback: number, opts?: { min?: number; max?: number }): number {
  const min = opts?.min ?? 1
  const max = opts?.max ?? 100
  const raw = value ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

export async function GET(req: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 })
  }

  const url = new URL(req.url)
  const q = String(url.searchParams.get('q') || '').trim()
  const page = clampInt(url.searchParams.get('page'), 1, { min: 1, max: 10_000 })
  const pageSize = clampInt(url.searchParams.get('pageSize'), 24, { min: 6, max: 100 })
  const skip = (page - 1) * pageSize
  const norm = normalizeSearch(q)

  const where = q
    ? {
        OR: [
          { slug: { contains: q.toLowerCase() } },
          { name_zh: { contains: q } },
          { name_en: { contains: q, mode: 'insensitive' as const } },
          { name_ja: { contains: q } },
          { aliases: { some: { aliasNorm: { contains: norm } } } },
        ],
      }
    : {}

  const [list, total] = await Promise.all([
    prisma.city.findMany({
      where,
      orderBy: [{ hidden: 'asc' }, { needsReview: 'desc' }, { updatedAt: 'desc' }],
      skip,
      take: pageSize,
      select: {
        id: true,
        slug: true,
        name_zh: true,
        name_en: true,
        name_ja: true,
        cover: true,
        needsReview: true,
        hidden: true,
        _count: { select: { aliases: true } },
      },
    }),
    prisma.city.count({ where }),
  ])

  const counts = await countPublishedArticlesByCityIds(list.map((c) => c.id)).catch(() => ({} as Record<string, number>))

  const items = list.map((c) => ({
    id: c.id,
    slug: c.slug,
    name_zh: c.name_zh,
    name_en: c.name_en,
    name_ja: c.name_ja,
    cover: c.cover,
    hidden: c.hidden,
    needsReview: c.needsReview,
    aliasCount: c._count.aliases,
    postCount: counts[c.id] || 0,
  }))

  return NextResponse.json({ ok: true, items, total, page, pageSize })
}
