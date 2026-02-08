import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

const TARGET_LANGUAGES = ['en', 'ja'] as const

type TargetLanguage = (typeof TARGET_LANGUAGES)[number]
type EntityType = 'article' | 'city' | 'anime'

export type UntranslatedItem = {
  entityType: EntityType
  entityId: string
  title: string
  date: string
  missingLanguages: TargetLanguage[]
}

type ArticleRow = {
  id: string
  title: string
  translationGroupId: string | null
  publishedAt: Date | null
  createdAt: Date
}

type CityRow = {
  id: string
  name_zh: string
  name_en: string | null
  name_ja: string | null
  description_en: string | null
  transportTips_en: string | null
  description_ja: string | null
  transportTips_ja: string | null
  createdAt: Date
}

type AnimeRow = {
  id: string
  name: string
  name_en: string | null
  name_ja: string | null
  summary_en: string | null
  summary_ja: string | null
  createdAt: Date
}

function dateToIso(d: Date | null | undefined): string {
  return (d ?? new Date(0)).toISOString()
}

function clampInt(value: string | null, fallback: number, opts?: { min?: number; max?: number }): number {
  const min = opts?.min ?? 1
  const max = opts?.max ?? 100
  const raw = value ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

function normalizeQuery(value: string | null): string {
  return String(value || '').trim().toLowerCase()
}

function parseEntityType(value: string | null): EntityType | 'all' {
  if (value === 'article' || value === 'city' || value === 'anime') return value
  return 'all'
}

function hasEntityTranslation(entityType: EntityType, row: CityRow | AnimeRow, lang: TargetLanguage): boolean {
  // Mirror the detection style in app/api/admin/translations/batch/route.ts.
  if (entityType === 'city') {
    const city = row as CityRow
    if (lang === 'en') return Boolean(city.name_en?.trim() && city.description_en?.trim() && city.transportTips_en?.trim())
    return Boolean(city.name_ja?.trim() && city.description_ja?.trim() && city.transportTips_ja?.trim())
  }

  const anime = row as AnimeRow
  if (lang === 'en') return Boolean(anime.name_en || anime.summary_en)
  return Boolean(anime.name_ja || anime.summary_ja)
}

async function getEntityIdsWithTasks(entityType: EntityType, entityIds: string[]): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set()

  const rows = await prisma.translationTask.findMany({
    where: {
      entityType,
      entityId: { in: entityIds },
      targetLanguage: { in: TARGET_LANGUAGES as unknown as string[] },
    },
    select: { entityId: true },
  })

  return new Set(rows.map((r) => r.entityId))
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = clampInt(searchParams.get('page'), 1, { min: 1, max: 10_000 })
    const pageSize = clampInt(searchParams.get('pageSize'), 30, { min: 5, max: 100 })
    const q = normalizeQuery(searchParams.get('q'))
    const entityTypeFilter = parseEntityType(searchParams.get('entityType'))

    const [articles, cities, anime] = await Promise.all([
      entityTypeFilter === 'all' || entityTypeFilter === 'article'
        ? (prisma.article.findMany({
            // Only published source (zh) articles should be considered.
            where: {
              status: 'published',
              language: 'zh',
            },
            select: {
              id: true,
              title: true,
              translationGroupId: true,
              publishedAt: true,
              createdAt: true,
            },
          }) as unknown as Promise<ArticleRow[]>)
        : Promise.resolve([]),
      entityTypeFilter === 'all' || entityTypeFilter === 'city'
        ? (prisma.city.findMany({
            // Hidden cities should not be translated.
            where: { hidden: false },
            select: {
              id: true,
              name_zh: true,
              name_en: true,
              name_ja: true,
              description_en: true,
              transportTips_en: true,
              description_ja: true,
              transportTips_ja: true,
              createdAt: true,
            },
          }) as unknown as Promise<CityRow[]>)
        : Promise.resolve([]),
      entityTypeFilter === 'all' || entityTypeFilter === 'anime'
        ? (prisma.anime.findMany({
            // Hidden anime should not be translated.
            where: { hidden: false },
            select: {
              id: true,
              name: true,
              name_en: true,
              name_ja: true,
              summary_en: true,
              summary_ja: true,
              createdAt: true,
            },
          }) as unknown as Promise<AnimeRow[]>)
        : Promise.resolve([]),
    ])

    const items: UntranslatedItem[] = []

    // Articles: translation versions are separate Article rows grouped by translationGroupId.
    if (articles.length > 0) {
      const articleIds = articles.map((a) => a.id)
      const taskArticleIds = await getEntityIdsWithTasks('article', articleIds)

      const groupById = new Map(articles.map((a) => [a.id, a.translationGroupId || a.id]))
      const groupIds = Array.from(new Set(Array.from(groupById.values())))

      const translated = await prisma.article.findMany({
        where: {
          language: { in: TARGET_LANGUAGES as unknown as string[] },
          status: 'published',
          translationGroupId: { in: groupIds },
        },
        select: {
          language: true,
          translationGroupId: true,
        },
      }) as unknown as Array<{ language: string; translationGroupId: string | null }>

      const approvedKey = new Set(
        translated
          .map((t) => {
            const gid = t.translationGroupId
            if (!gid) return null
            return `${gid}:${t.language}`
          })
          .filter(Boolean) as string[]
      )

      for (const a of articles) {
        // Filter out entities that already have any TranslationTask.
        if (taskArticleIds.has(a.id)) continue

        const gid = groupById.get(a.id)
        if (!gid) continue

        const missingLanguages: TargetLanguage[] = []
        for (const lang of TARGET_LANGUAGES) {
          if (!approvedKey.has(`${gid}:${lang}`)) missingLanguages.push(lang)
        }

        if (missingLanguages.length === 0) continue

        items.push({
          entityType: 'article',
          entityId: a.id,
          title: a.title,
          date: dateToIso(a.publishedAt ?? a.createdAt),
          missingLanguages,
        })
      }
    }

    // Cities: column-based i18n.
    if (cities.length > 0) {
      const cityIds = cities.map((c) => c.id)
      const taskCityIds = await getEntityIdsWithTasks('city', cityIds)

      for (const c of cities) {
        if (taskCityIds.has(c.id)) continue

        const missingLanguages: TargetLanguage[] = []
        for (const lang of TARGET_LANGUAGES) {
          if (!hasEntityTranslation('city', c, lang)) missingLanguages.push(lang)
        }

        if (missingLanguages.length === 0) continue

        items.push({
          entityType: 'city',
          entityId: c.id,
          title: c.name_zh,
          date: dateToIso(c.createdAt),
          missingLanguages,
        })
      }
    }

    // Anime: column-based i18n.
    if (anime.length > 0) {
      const animeIds = anime.map((a) => a.id)
      const taskAnimeIds = await getEntityIdsWithTasks('anime', animeIds)

      for (const a of anime) {
        if (taskAnimeIds.has(a.id)) continue

        const missingLanguages: TargetLanguage[] = []
        for (const lang of TARGET_LANGUAGES) {
          if (!hasEntityTranslation('anime', a, lang)) missingLanguages.push(lang)
        }

        if (missingLanguages.length === 0) continue

        items.push({
          entityType: 'anime',
          entityId: a.id,
          title: a.name,
          date: dateToIso(a.createdAt),
          missingLanguages,
        })
      }
    }

    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

    const filtered = q
      ? items.filter((item) => {
          const haystack = `${item.title} ${item.entityId} ${item.entityType}`.toLowerCase()
          return haystack.includes(q)
        })
      : items

    const total = filtered.length
    const start = (page - 1) * pageSize
    const paged = filtered.slice(start, start + pageSize)

    return NextResponse.json({
      items: paged,
      total,
      page,
      pageSize,
      q: q || undefined,
      entityType: entityTypeFilter,
    })
  } catch (error) {
    console.error('[api/admin/translations/untranslated] GET failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
