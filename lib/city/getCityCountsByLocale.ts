import { unstable_cache } from 'next/cache'
import { countPublishedArticlesByCityIds, listCitiesForIndex } from '@/lib/city/db'
import { normalizeCityAlias } from '@/lib/city/normalize'
import { prisma } from '@/lib/db/prisma'
import { toHomeDataSourceError } from '@/lib/home/dataSourceError'
import type { SupportedLocale } from '@/lib/i18n/types'
import { getAllPublicPosts, getAllPublicPostsForHome } from '@/lib/posts/getAllPublicPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'

type CityCountsByLocale = {
  cities: Awaited<ReturnType<typeof listCitiesForIndex>>
  counts: Record<string, number>
}

type FailureMode = 'fallback' | 'throw'

async function loadCitySource<T>(
  source: string,
  load: () => Promise<T>,
  fallback: T,
  failureMode: FailureMode
): Promise<T> {
  try {
    return await load()
  } catch (reason) {
    if (failureMode === 'throw') {
      throw toHomeDataSourceError(source, 'failure', reason)
    }
    return fallback
  }
}

async function loadCityCountsByLocale(
  locale: SupportedLocale,
  failureMode: FailureMode = 'fallback'
): Promise<CityCountsByLocale> {
  if (failureMode === 'throw' && !process.env.DATABASE_URL) {
    return { cities: [], counts: {} }
  }

  const cities = await loadCitySource('city.list', listCitiesForIndex, [], failureMode)
  if (!cities.length) return { cities: [], counts: {} }

  const dbCounts = await loadCitySource(
    'city.article-counts',
    () => countPublishedArticlesByCityIds(cities.map((c) => c.id), locale),
    {} as Record<string, number>,
    failureMode
  )

  // Include MDX posts in counts when their city matches a known alias.
  const aliasRows = await loadCitySource(
    'city.aliases',
    () => prisma.cityAlias.findMany({ select: { cityId: true, aliasNorm: true } }),
    [],
    failureMode
  )
  const aliasToCityId = new Map<string, string>()
  for (const r of aliasRows) {
    if (r?.aliasNorm && r?.cityId) aliasToCityId.set(r.aliasNorm, r.cityId)
  }

  for (const c of cities) {
    aliasToCityId.set(normalizeCityAlias(c.slug), c.id)
    aliasToCityId.set(normalizeCityAlias(c.name_zh), c.id)
    if (c.name_en) aliasToCityId.set(normalizeCityAlias(c.name_en), c.id)
    if (c.name_ja) aliasToCityId.set(normalizeCityAlias(c.name_ja), c.id)
  }

  const publicPosts = await loadCitySource(
    'city.public-posts',
    () => failureMode === 'throw'
      ? getAllPublicPostsForHome(locale)
      : getAllPublicPosts(locale),
    [],
    failureMode
  )
  const publicCounts: Record<string, number> = {}
  for (const p of publicPosts) {
    if (isSeoSpokePost(p)) continue
    const norm = normalizeCityAlias(String((p as any).city || ''))
    if (!norm) continue
    const cityId = aliasToCityId.get(norm)
    if (!cityId) continue
    publicCounts[cityId] = (publicCounts[cityId] || 0) + 1
  }

  const counts: Record<string, number> = {}
  for (const c of cities) {
    counts[c.id] = Math.max(dbCounts[c.id] || 0, publicCounts[c.id] || 0)
  }

  return { cities, counts }
}

const getCachedCityCountsByLocale = unstable_cache(
  async (locale: SupportedLocale) => loadCityCountsByLocale(locale),
  ['city:getCityCountsByLocale'],
  { revalidate: 300 }
)

export async function getCityCountsByLocale(locale: SupportedLocale): Promise<CityCountsByLocale> {
  return getCachedCityCountsByLocale(locale)
}

export async function getCityCountsByLocaleForHome(
  locale: SupportedLocale
): Promise<CityCountsByLocale> {
  return loadCityCountsByLocale(locale, 'throw')
}
