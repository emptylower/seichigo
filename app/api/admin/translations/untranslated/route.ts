import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

type EntityType = 'article' | 'city' | 'anime'
type TargetLanguage = 'en' | 'ja'

export type UntranslatedItem = {
  entityType: EntityType
  entityId: string
  title: string
  date: string
  missingLanguages: TargetLanguage[]
}

const TARGET_LANGS: TargetLanguage[] = ['en', 'ja']

function isNonEmptyText(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const items: UntranslatedItem[] = []

    // Articles: translation versions are separate Article rows grouped by translationGroupId.
    const articleRows = await prisma.article.findMany({
      where: { status: 'published' },
      select: {
        id: true,
        title: true,
        translationGroupId: true,
        publishedAt: true,
        createdAt: true,
      },
    })

    const articleIds = articleRows.map((r) => r.id)
    const articleGroupIds = articleRows.map((r) => r.translationGroupId || r.id)

    const translatedArticleRows = articleGroupIds.length
      ? await prisma.article.findMany({
          where: {
            language: { in: TARGET_LANGS },
            translationGroupId: { in: articleGroupIds },
          },
          select: { language: true, translationGroupId: true },
        })
      : []

    const translatedKey = new Set(
      translatedArticleRows
        .map((t) => {
          const gid = t.translationGroupId
          if (!gid) return null
          const lang = t.language as TargetLanguage
          if (lang !== 'en' && lang !== 'ja') return null
          return `${gid}:${lang}`
        })
        .filter(Boolean) as string[]
    )

    // If an entity already has any TranslationTask, exclude it from discovery.
    const existingArticleTasks = articleIds.length
      ? await prisma.translationTask.findMany({
          where: {
            entityType: 'article',
            entityId: { in: articleIds },
            targetLanguage: { in: TARGET_LANGS },
          },
          select: { entityId: true },
        })
      : []

    const articleHasAnyTask = new Set(existingArticleTasks.map((t) => t.entityId))

    for (const r of articleRows) {
      if (articleHasAnyTask.has(r.id)) continue
      const gid = r.translationGroupId || r.id
      const missing: TargetLanguage[] = []
      for (const lang of TARGET_LANGS) {
        if (!translatedKey.has(`${gid}:${lang}`)) {
          missing.push(lang)
        }
      }

      if (missing.length > 0) {
        const date = (r.publishedAt || r.createdAt).toISOString()
        items.push({
          entityType: 'article',
          entityId: r.id,
          title: r.title,
          date,
          missingLanguages: missing,
        })
      }
    }

    // Cities: column-level i18n; hidden cities should not be translated.
    const cityRows = await prisma.city.findMany({
      where: { hidden: false },
      select: {
        id: true,
        name_zh: true,
        name_en: true,
        name_ja: true,
        description_en: true,
        transportTips_en: true,
        createdAt: true,
      },
    })

    const cityIds = cityRows.map((r) => r.id)
    const existingCityTasks = cityIds.length
      ? await prisma.translationTask.findMany({
          where: {
            entityType: 'city',
            entityId: { in: cityIds },
            targetLanguage: { in: TARGET_LANGS },
          },
          select: { entityId: true },
        })
      : []
    const cityHasAnyTask = new Set(existingCityTasks.map((t) => t.entityId))

    for (const r of cityRows) {
      if (cityHasAnyTask.has(r.id)) continue
      const missing: TargetLanguage[] = []
      if (!isNonEmptyText(r.name_en)) missing.push('en')
      if (!isNonEmptyText(r.name_ja)) missing.push('ja')

      if (missing.length > 0) {
        items.push({
          entityType: 'city',
          entityId: r.id,
          title: r.name_zh,
          date: r.createdAt.toISOString(),
          missingLanguages: missing,
        })
      }
    }

    // Anime: column-level i18n; hidden anime should not be translated.
    const animeRows = await prisma.anime.findMany({
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
    })

    const animeIds = animeRows.map((r) => r.id)
    const existingAnimeTasks = animeIds.length
      ? await prisma.translationTask.findMany({
          where: {
            entityType: 'anime',
            entityId: { in: animeIds },
            targetLanguage: { in: TARGET_LANGS },
          },
          select: { entityId: true },
        })
      : []
    const animeHasAnyTask = new Set(existingAnimeTasks.map((t) => t.entityId))

    for (const r of animeRows) {
      if (animeHasAnyTask.has(r.id)) continue
      const missing: TargetLanguage[] = []
      if (!isNonEmptyText(r.name_en)) missing.push('en')
      if (!isNonEmptyText(r.name_ja)) missing.push('ja')

      if (missing.length > 0) {
        items.push({
          entityType: 'anime',
          entityId: r.id,
          title: r.name,
          date: r.createdAt.toISOString(),
          missingLanguages: missing,
        })
      }
    }

    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

    return NextResponse.json({ items, total: items.length })
  } catch (error) {
    console.error('[api/admin/translations/untranslated] GET failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
