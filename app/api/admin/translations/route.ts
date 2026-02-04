import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

type EntityType = 'article' | 'city' | 'anime'

type TaskListSubject = {
  title: string | null
  subtitle: string | null
  slug: string | null
}

type TaskListTarget = {
  id: string
  title: string | null
  slug: string | null
  status: string | null
  publishedAt: string | null
  updatedAt: string | null
}

type TaskListItem = {
  id: string
  entityType: string
  entityId: string
  targetLanguage: string
  status: string
  createdAt: string
  updatedAt: string
  error: string | null
  subject: TaskListSubject
  target: TaskListTarget | null
}

function clampInt(input: string | null, fallback: number, opts?: { min?: number; max?: number }): number {
  const min = opts?.min ?? 1
  const max = opts?.max ?? 100
  const raw = input ? Number.parseInt(input, 10) : NaN
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

function normalizeQuery(input: string | null): string | null {
  const q = String(input || '').trim()
  if (!q) return null
  // Avoid accidental huge payloads / pathological queries.
  return q.length > 200 ? q.slice(0, 200) : q
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const entityType = searchParams.get('entityType')
    const targetLanguage = searchParams.get('targetLanguage')
    const q = normalizeQuery(searchParams.get('q'))
    const page = clampInt(searchParams.get('page'), 1, { min: 1, max: 10_000 })
    const pageSize = clampInt(searchParams.get('pageSize'), 20, { min: 1, max: 100 })

    const where: any = {}
    if (status && status !== 'all') where.status = status
    if (entityType && entityType !== 'all') where.entityType = entityType
    if (targetLanguage && targetLanguage !== 'all') where.targetLanguage = targetLanguage

    if (q) {
      const qOr: any[] = [
        { id: { contains: q, mode: 'insensitive' } },
        { entityId: { contains: q, mode: 'insensitive' } },
      ]

      const entityTypeFilter = entityType && entityType !== 'all' ? (entityType as EntityType) : null

      const [articleRows, cityRows, animeRows] = await Promise.all([
        !entityTypeFilter || entityTypeFilter === 'article'
          ? prisma.article.findMany({
              where: {
                OR: [
                  { title: { contains: q, mode: 'insensitive' } },
                  { slug: { contains: q, mode: 'insensitive' } },
                  { id: { contains: q, mode: 'insensitive' } },
                  { translationGroupId: { contains: q, mode: 'insensitive' } },
                ],
              },
              select: { id: true, translationGroupId: true },
              take: 100,
            })
          : Promise.resolve([]),
        !entityTypeFilter || entityTypeFilter === 'city'
          ? prisma.city.findMany({
              where: {
                OR: [
                  { slug: { contains: q, mode: 'insensitive' } },
                  { name_zh: { contains: q, mode: 'insensitive' } },
                  { name_en: { contains: q, mode: 'insensitive' } },
                  { name_ja: { contains: q, mode: 'insensitive' } },
                ],
              },
              select: { id: true },
              take: 100,
            })
          : Promise.resolve([]),
        !entityTypeFilter || entityTypeFilter === 'anime'
          ? prisma.anime.findMany({
              where: {
                OR: [
                  { id: { contains: q, mode: 'insensitive' } },
                  { name: { contains: q, mode: 'insensitive' } },
                  { name_en: { contains: q, mode: 'insensitive' } },
                  { name_ja: { contains: q, mode: 'insensitive' } },
                ],
              },
              select: { id: true },
              take: 100,
            })
          : Promise.resolve([]),
      ])

      if (articleRows.length > 0) {
        const groupIds = Array.from(
          new Set(articleRows.map((r) => String(r.translationGroupId || r.id)).filter(Boolean))
        )
        if (groupIds.length > 0) {
          qOr.push({
            AND: [{ entityType: 'article' }, { entityId: { in: groupIds } }],
          })
        }
      }

      if (cityRows.length > 0) {
        const ids = Array.from(new Set(cityRows.map((r) => String(r.id)).filter(Boolean)))
        if (ids.length > 0) {
          qOr.push({
            AND: [{ entityType: 'city' }, { entityId: { in: ids } }],
          })
        }
      }

      if (animeRows.length > 0) {
        const ids = Array.from(new Set(animeRows.map((r) => String(r.id)).filter(Boolean)))
        if (ids.length > 0) {
          qOr.push({
            AND: [{ entityType: 'anime' }, { entityId: { in: ids } }],
          })
        }
      }

      where.OR = qOr
    }

    const [tasks, total] = await Promise.all([
      prisma.translationTask.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          entityType: true,
          entityId: true,
          targetLanguage: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          error: true,
        },
      }),
      prisma.translationTask.count({ where }),
    ])

    const articleIds = Array.from(
      new Set(tasks.filter((t) => t.entityType === 'article').map((t) => t.entityId))
    )
    const cityIds = Array.from(
      new Set(tasks.filter((t) => t.entityType === 'city').map((t) => t.entityId))
    )
    const animeIds = Array.from(
      new Set(tasks.filter((t) => t.entityType === 'anime').map((t) => t.entityId))
    )

    const [articles, cities, anime, articleTargets] = await Promise.all([
      articleIds.length > 0
        ? prisma.article.findMany({
            where: { id: { in: articleIds } },
            select: {
              id: true,
              title: true,
              slug: true,
            },
          })
        : Promise.resolve([]),
      cityIds.length > 0
        ? prisma.city.findMany({
            where: { id: { in: cityIds } },
            select: {
              id: true,
              slug: true,
              name_zh: true,
            },
          })
        : Promise.resolve([]),
      animeIds.length > 0
        ? prisma.anime.findMany({
            where: { id: { in: animeIds } },
            select: {
              id: true,
              name: true,
            },
          })
        : Promise.resolve([]),
      articleIds.length > 0
        ? prisma.article.findMany({
            where: {
              translationGroupId: { in: articleIds },
              language: { in: ['en', 'ja'] },
            },
            select: {
              id: true,
              title: true,
              slug: true,
              status: true,
              publishedAt: true,
              updatedAt: true,
              language: true,
              translationGroupId: true,
            },
          })
        : Promise.resolve([]),
    ])

    const articleById = new Map(articles.map((a) => [a.id, a]))
    const cityById = new Map(cities.map((c) => [c.id, c]))
    const animeById = new Map(anime.map((a) => [a.id, a]))

    const targetByKey = new Map<string, any>()
    for (const a of articleTargets as any[]) {
      const gid = String(a.translationGroupId || '').trim()
      const lang = String(a.language || '').trim()
      if (!gid || !lang) continue
      targetByKey.set(`${gid}:${lang}`, a)
    }

    const items: TaskListItem[] = tasks.map((t) => {
      const base = {
        id: String(t.id),
        entityType: String(t.entityType),
        entityId: String(t.entityId),
        targetLanguage: String(t.targetLanguage),
        status: String(t.status),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        error: t.error ? String(t.error) : null,
      }

      if (t.entityType === 'article') {
        const a = articleById.get(t.entityId)
        const target = targetByKey.get(`${t.entityId}:${t.targetLanguage}`) || null
        return {
          ...base,
          subject: {
            title: a?.title ? String(a.title) : null,
            subtitle: a?.slug ? `slug：${String(a.slug)}` : null,
            slug: a?.slug ? String(a.slug) : null,
          },
          target: target
            ? {
                id: String(target.id),
                title: target?.title ? String(target.title) : null,
                slug: target?.slug ? String(target.slug) : null,
                status: target?.status ? String(target.status) : null,
                publishedAt: target?.publishedAt ? target.publishedAt.toISOString() : null,
                updatedAt: target?.updatedAt ? target.updatedAt.toISOString() : null,
              }
            : null,
        }
      }

      if (t.entityType === 'city') {
        const c = cityById.get(t.entityId)
        return {
          ...base,
          subject: {
            title: c?.name_zh ? String(c.name_zh) : null,
            subtitle: c?.slug ? `slug：${String(c.slug)}` : null,
            slug: c?.slug ? String(c.slug) : null,
          },
          target: null,
        }
      }

      if (t.entityType === 'anime') {
        const a = animeById.get(t.entityId)
        return {
          ...base,
          subject: {
            title: a?.name ? String(a.name) : null,
            subtitle: `id：${String(t.entityId)}`,
            slug: null,
          },
          target: null,
        }
      }

      return {
        ...base,
        subject: {
          title: null,
          subtitle: null,
          slug: null,
        },
        target: null,
      }
    })

    return NextResponse.json({ tasks: items, total, page, pageSize, q })
  } catch (error) {
    console.error('[api/admin/translations] GET failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { entityType, entityId, targetLanguages } = body

    if (!entityType || !entityId || !Array.isArray(targetLanguages)) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const tasks = await Promise.all(
      targetLanguages.map((targetLanguage) =>
        prisma.translationTask.upsert({
          where: {
            entityType_entityId_targetLanguage: {
              entityType,
              entityId,
              targetLanguage,
            },
          },
          create: {
            entityType,
            entityId,
            targetLanguage,
            status: 'pending',
          },
          update: {},
        })
      )
    )

    return NextResponse.json({ tasks })
  } catch (error) {
    console.error('[api/admin/translations] POST failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
