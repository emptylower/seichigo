import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

export type AdminTranslationEntityType = 'article' | 'city' | 'anime' | 'anitabi_bangumi' | 'anitabi_point'

export type TranslationTaskListSubject = {
  title: string | null
  subtitle: string | null
  slug: string | null
}

export type TranslationTaskListTarget = {
  id: string
  title: string | null
  slug: string | null
  status: string | null
  publishedAt: string | null
  updatedAt: string | null
}

export type TranslationTaskListItem = {
  id: string
  entityType: string
  entityId: string
  targetLanguage: string
  status: string
  createdAt: string
  updatedAt: string
  error: string | null
  subject: TranslationTaskListSubject
  target: TranslationTaskListTarget | null
}

export type TranslationTaskListQueryInput = {
  status?: string | null
  entityType?: string | null
  targetLanguage?: string | null
  q?: string | null
  page?: number | string | null
  pageSize?: number | string | null
}

export type TranslationTaskListQuery = {
  status: string
  entityType: string
  targetLanguage: string
  q: string | null
  page: number
  pageSize: number
}

export type TranslationTaskListResult = {
  tasks: TranslationTaskListItem[]
  total: number
  page: number
  pageSize: number
  q: string | null
}

export type TranslationTaskStatsFilterInput = {
  entityType?: string | null
  targetLanguage?: string | null
}

export type TranslationTaskStatsFilter = {
  entityType: string
  targetLanguage: string
}

function clampInt(input: number | string | null | undefined, fallback: number, opts?: { min?: number; max?: number }): number {
  const min = opts?.min ?? 1
  const max = opts?.max ?? 100
  const raw =
    typeof input === 'number'
      ? input
      : typeof input === 'string'
        ? Number.parseInt(input, 10)
        : Number.NaN
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

function normalizeQuery(input: string | null | undefined): string | null {
  const q = String(input || '').trim()
  if (!q) return null
  return q.length > 200 ? q.slice(0, 200) : q
}

function normalizeFilter(input: string | null | undefined, fallback: string): string {
  const value = String(input || '').trim()
  if (!value) return fallback
  return value
}

function normalizeStatus(input: string | null | undefined): string {
  const value = String(input || '').trim()
  if (!value) return 'ready'
  const allowed = new Set(['all', 'pending', 'processing', 'ready', 'approved', 'failed'])
  return allowed.has(value) ? value : 'ready'
}

function normalizeEntityType(input: string | null | undefined): string {
  const value = String(input || '').trim()
  if (!value) return 'all'
  const allowed = new Set(['all', 'article', 'city', 'anime', 'anitabi_bangumi', 'anitabi_point'])
  return allowed.has(value) ? value : 'all'
}

export function parseTranslationTaskListQuery(input: TranslationTaskListQueryInput): TranslationTaskListQuery {
  return {
    status: normalizeStatus(input.status),
    entityType: normalizeEntityType(input.entityType),
    targetLanguage: normalizeFilter(input.targetLanguage, 'all'),
    q: normalizeQuery(input.q),
    page: clampInt(input.page, 1, { min: 1, max: 10_000 }),
    pageSize: clampInt(input.pageSize, 20, { min: 1, max: 100 }),
  }
}

export function parseTranslationTaskStatsFilter(input: TranslationTaskStatsFilterInput): TranslationTaskStatsFilter {
  return {
    entityType: normalizeEntityType(input.entityType),
    targetLanguage: normalizeFilter(input.targetLanguage, 'all'),
  }
}

export async function listTranslationTasksForAdmin(query: TranslationTaskListQuery): Promise<TranslationTaskListResult> {
  const where: Prisma.TranslationTaskWhereInput = {}
  if (query.status !== 'all') where.status = query.status
  if (query.entityType !== 'all') where.entityType = query.entityType
  if (query.targetLanguage !== 'all') where.targetLanguage = query.targetLanguage

  if (query.q) {
    const qOr: Prisma.TranslationTaskWhereInput[] = [
      { id: { contains: query.q, mode: 'insensitive' } },
      { entityId: { contains: query.q, mode: 'insensitive' } },
    ]

    const includeArticle = query.entityType === 'all' || query.entityType === 'article'
    const includeCity = query.entityType === 'all' || query.entityType === 'city'
    const includeAnime = query.entityType === 'all' || query.entityType === 'anime'
    const includeAnitabiBangumi = query.entityType === 'all' || query.entityType === 'anitabi_bangumi'
    const includeAnitabiPoint = query.entityType === 'all' || query.entityType === 'anitabi_point'

    const [articleRows, cityRows, animeRows, anitabiBangumiRows, anitabiPointRows] = await Promise.all([
      includeArticle
        ? prisma.article.findMany({
            where: {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { slug: { contains: query.q, mode: 'insensitive' } },
                { id: { contains: query.q, mode: 'insensitive' } },
                { translationGroupId: { contains: query.q, mode: 'insensitive' } },
              ],
            },
            select: { id: true, translationGroupId: true },
            take: 100,
          })
        : Promise.resolve([]),
      includeCity
        ? prisma.city.findMany({
            where: {
              OR: [
                { slug: { contains: query.q, mode: 'insensitive' } },
                { name_zh: { contains: query.q, mode: 'insensitive' } },
                { name_en: { contains: query.q, mode: 'insensitive' } },
                { name_ja: { contains: query.q, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
            take: 100,
          })
        : Promise.resolve([]),
      includeAnime
        ? prisma.anime.findMany({
            where: {
              OR: [
                { id: { contains: query.q, mode: 'insensitive' } },
                { name: { contains: query.q, mode: 'insensitive' } },
                { name_en: { contains: query.q, mode: 'insensitive' } },
                { name_ja: { contains: query.q, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
            take: 100,
          })
        : Promise.resolve([]),
      includeAnitabiBangumi
        ? prisma.anitabiBangumi.findMany({
            where: {
              OR: [
                { titleZh: { contains: query.q, mode: 'insensitive' } },
                { titleJaRaw: { contains: query.q, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
            take: 100,
          })
        : Promise.resolve([]),
      includeAnitabiPoint
        ? prisma.anitabiPoint.findMany({
            where: {
              OR: [
                { id: { contains: query.q, mode: 'insensitive' } },
                { name: { contains: query.q, mode: 'insensitive' } },
                { nameZh: { contains: query.q, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
            take: 100,
          })
        : Promise.resolve([]),
    ])

    if (articleRows.length > 0) {
      const groupIds = Array.from(
        new Set(articleRows.map((row) => String(row.translationGroupId || row.id)).filter(Boolean))
      )
      if (groupIds.length > 0) {
        qOr.push({
          AND: [{ entityType: 'article' }, { entityId: { in: groupIds } }],
        })
      }
    }

    if (cityRows.length > 0) {
      const ids = Array.from(new Set(cityRows.map((row) => String(row.id)).filter(Boolean)))
      if (ids.length > 0) {
        qOr.push({
          AND: [{ entityType: 'city' }, { entityId: { in: ids } }],
        })
      }
    }

    if (animeRows.length > 0) {
      const ids = Array.from(new Set(animeRows.map((row) => String(row.id)).filter(Boolean)))
      if (ids.length > 0) {
        qOr.push({
          AND: [{ entityType: 'anime' }, { entityId: { in: ids } }],
        })
      }
    }

    if (anitabiBangumiRows.length > 0) {
      const ids = Array.from(new Set(anitabiBangumiRows.map((row) => String(row.id)).filter(Boolean)))
      if (ids.length > 0) {
        qOr.push({
          AND: [{ entityType: 'anitabi_bangumi' }, { entityId: { in: ids } }],
        })
      }
    }

    if (anitabiPointRows.length > 0) {
      const ids = Array.from(new Set(anitabiPointRows.map((row) => String(row.id)).filter(Boolean)))
      if (ids.length > 0) {
        qOr.push({
          AND: [{ entityType: 'anitabi_point' }, { entityId: { in: ids } }],
        })
      }
    }

    where.OR = qOr
  }

  const [tasks, total] = await Promise.all([
    prisma.translationTask.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
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

  const articleIds = Array.from(new Set(tasks.filter((task) => task.entityType === 'article').map((task) => task.entityId)))
  const cityIds = Array.from(new Set(tasks.filter((task) => task.entityType === 'city').map((task) => task.entityId)))
  const animeIds = Array.from(new Set(tasks.filter((task) => task.entityType === 'anime').map((task) => task.entityId)))
  const anitabiBangumiIds = Array.from(
    new Set(tasks.filter((task) => task.entityType === 'anitabi_bangumi').map((task) => task.entityId))
  )
  const anitabiPointIds = Array.from(
    new Set(tasks.filter((task) => task.entityType === 'anitabi_point').map((task) => task.entityId))
  )

  const [articles, cities, anime, articleTargets, anitabiBangumi, anitabiPoints] = await Promise.all([
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
    anitabiBangumiIds.length > 0
      ? prisma.anitabiBangumi.findMany({
          where: { id: { in: anitabiBangumiIds.map((id) => Number.parseInt(id, 10)).filter((id) => Number.isFinite(id)) } },
          select: {
            id: true,
            titleZh: true,
            titleJaRaw: true,
          },
        })
      : Promise.resolve([]),
    anitabiPointIds.length > 0
      ? prisma.anitabiPoint.findMany({
          where: { id: { in: anitabiPointIds } },
          select: {
            id: true,
            name: true,
            nameZh: true,
          },
        })
      : Promise.resolve([]),
  ])

  const articleById = new Map(articles.map((article) => [article.id, article]))
  const cityById = new Map(cities.map((city) => [city.id, city]))
  const animeById = new Map(anime.map((row) => [row.id, row]))
  const anitabiBangumiById = new Map(anitabiBangumi.map((row) => [String(row.id), row]))
  const anitabiPointById = new Map(anitabiPoints.map((row) => [row.id, row]))

  const targetByKey = new Map<string, (typeof articleTargets)[number]>()
  for (const row of articleTargets) {
    const gid = String(row.translationGroupId || '').trim()
    const lang = String(row.language || '').trim()
    if (!gid || !lang) continue
    targetByKey.set(`${gid}:${lang}`, row)
  }

  const items: TranslationTaskListItem[] = tasks.map((task) => {
    const base = {
      id: String(task.id),
      entityType: String(task.entityType),
      entityId: String(task.entityId),
      targetLanguage: String(task.targetLanguage),
      status: String(task.status),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      error: task.error ? String(task.error) : null,
    }

    if (task.entityType === 'article') {
      const article = articleById.get(task.entityId)
      const target = targetByKey.get(`${task.entityId}:${task.targetLanguage}`) || null
      return {
        ...base,
        subject: {
          title: article?.title ? String(article.title) : null,
          subtitle: article?.slug ? `slug：${String(article.slug)}` : null,
          slug: article?.slug ? String(article.slug) : null,
        },
        target: target
          ? {
              id: String(target.id),
              title: target.title ? String(target.title) : null,
              slug: target.slug ? String(target.slug) : null,
              status: target.status ? String(target.status) : null,
              publishedAt: target.publishedAt ? target.publishedAt.toISOString() : null,
              updatedAt: target.updatedAt ? target.updatedAt.toISOString() : null,
            }
          : null,
      }
    }

    if (task.entityType === 'city') {
      const city = cityById.get(task.entityId)
      return {
        ...base,
        subject: {
          title: city?.name_zh ? String(city.name_zh) : null,
          subtitle: city?.slug ? `slug：${String(city.slug)}` : null,
          slug: city?.slug ? String(city.slug) : null,
        },
        target: null,
      }
    }

    if (task.entityType === 'anime') {
      const animeItem = animeById.get(task.entityId)
      return {
        ...base,
        subject: {
          title: animeItem?.name ? String(animeItem.name) : null,
          subtitle: `id：${String(task.entityId)}`,
          slug: null,
        },
        target: null,
      }
    }

    if (task.entityType === 'anitabi_bangumi') {
      const item = anitabiBangumiById.get(task.entityId)
      return {
        ...base,
        subject: {
          title: item?.titleZh ? String(item.titleZh) : item?.titleJaRaw ? String(item.titleJaRaw) : null,
          subtitle: `id：${String(task.entityId)}`,
          slug: null,
        },
        target: null,
      }
    }

    if (task.entityType === 'anitabi_point') {
      const item = anitabiPointById.get(task.entityId)
      return {
        ...base,
        subject: {
          title: item?.nameZh ? String(item.nameZh) : item?.name ? String(item.name) : null,
          subtitle: `id：${String(task.entityId)}`,
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

  return {
    tasks: items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    q: query.q,
  }
}

export async function getTranslationTaskStatsForAdmin(filter: TranslationTaskStatsFilter): Promise<Record<string, number>> {
  const where: Prisma.TranslationTaskWhereInput = {}
  if (filter.entityType !== 'all') where.entityType = filter.entityType
  if (filter.targetLanguage !== 'all') where.targetLanguage = filter.targetLanguage

  const rows = await prisma.translationTask.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  })

  const counts: Record<string, number> = {}
  for (const row of rows) {
    counts[String(row.status)] = Number(row._count._all || 0)
  }

  return counts
}
