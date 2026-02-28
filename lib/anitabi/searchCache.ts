import type { PrismaClient } from '@prisma/client'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { AnitabiSearchResultDTO } from '@/lib/anitabi/types'
import { translateText } from '@/lib/translation/gemini'
import { searchDataset } from '@/lib/anitabi/read'

const CACHE_TTL_DAYS = 7

export async function translateSearchQuery(
  prisma: PrismaClient,
  query: string,
  targetLanguages: string[]
): Promise<Record<string, string>> {
  const normalizedQuery = query.toLowerCase().trim()

  // Check cache
  const cached = await prisma.searchQueryCache.findUnique({
    where: { queryText: normalizedQuery },
  })

  const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)
  if (cached && cached.createdAt > cutoff) {
    return {
      zh: cached.translatedZh || query,
      en: cached.translatedEn || query,
      ja: cached.translatedJa || query,
    }
  }

  // Cache miss - translate via Gemini
  const translations: Record<string, string> = {}
  for (const lang of targetLanguages) {
    try {
      translations[lang] = await translateText(query, lang)
    } catch (err) {
      console.error(`[translateSearchQuery] Failed to translate to ${lang}:`, err)
      translations[lang] = query // Fallback to original
    }
  }

  // Write cache (upsert handles expired entries)
  await prisma.searchQueryCache.upsert({
    where: { queryText: normalizedQuery },
    create: {
      queryText: normalizedQuery,
      queryLanguage: 'auto',
      translatedZh: translations.zh ?? null,
      translatedEn: translations.en ?? null,
      translatedJa: translations.ja ?? null,
    },
    update: {
      translatedZh: translations.zh ?? null,
      translatedEn: translations.en ?? null,
      translatedJa: translations.ja ?? null,
      createdAt: new Date(), // Refresh TTL
    },
  })

  return translations
}

export async function searchWithFallback(
  prisma: PrismaClient,
  locale: SupportedLocale,
  q: string
): Promise<AnitabiSearchResultDTO> {
  // Primary search
  const primaryResults = await searchDataset({ prisma, locale, q })

  // If results found, return immediately
  if (primaryResults.bangumi.length > 0 || primaryResults.points.length > 0) {
    return primaryResults
  }

  // Fallback: translate query and re-search
  const translations = await translateSearchQuery(prisma, q, ['zh', 'en', 'ja'])

  // Build unique queries (skip duplicates of original)
  const normalizedQ = q.toLowerCase().trim()
  const uniqueQueries = new Set<string>()
  for (const translated of Object.values(translations)) {
    const norm = translated.toLowerCase().trim()
    if (norm && norm !== normalizedQ) {
      uniqueQueries.add(translated)
    }
  }

  if (uniqueQueries.size === 0) {
    return primaryResults // All translations same as original
  }

  // Re-search with translated queries
  const fallbackResults = await Promise.all(
    Array.from(uniqueQueries).map((tq) =>
      searchDataset({ prisma, locale, q: tq })
    )
  )

  // Merge and deduplicate
  const bangumiMap = new Map<number, AnitabiSearchResultDTO['bangumi'][number]>()
  const pointMap = new Map<string, AnitabiSearchResultDTO['points'][number]>()
  const citySet = new Set<string>()

  for (const result of fallbackResults) {
    for (const b of result.bangumi) {
      if (!bangumiMap.has(b.id)) bangumiMap.set(b.id, b)
    }
    for (const p of result.points) {
      if (!pointMap.has(p.id)) pointMap.set(p.id, p)
    }
    for (const c of result.cities) {
      citySet.add(c)
    }
  }

  return {
    bangumi: Array.from(bangumiMap.values()),
    points: Array.from(pointMap.values()),
    cities: Array.from(citySet),
  }
}
