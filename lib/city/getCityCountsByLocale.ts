import { countPublishedArticlesByCityIds, listCitiesForIndex } from '@/lib/city/db'
import { normalizeCityAlias } from '@/lib/city/normalize'
import { prisma } from '@/lib/db/prisma'
import { getAllPosts as getAllMdxPosts } from '@/lib/mdx/getAllPosts'
import type { SupportedLocale } from '@/lib/i18n/types'
import { isSeoSpokePost } from '@/lib/posts/visibility'

type CityCountsByLocale = {
  cities: Awaited<ReturnType<typeof listCitiesForIndex>>
  counts: Record<string, number>
}

export async function getCityCountsByLocale(locale: SupportedLocale): Promise<CityCountsByLocale> {
  const cities = await listCitiesForIndex().catch(() => [])
  if (!cities.length) return { cities: [], counts: {} }

  const dbCounts = await countPublishedArticlesByCityIds(cities.map((c) => c.id), locale).catch(
    () => ({} as Record<string, number>)
  )

  // Include MDX posts in counts when their city matches a known alias.
  const aliasRows = await prisma.cityAlias.findMany({ select: { cityId: true, aliasNorm: true } }).catch(() => [])
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

  const mdxPosts = await getAllMdxPosts(locale).catch(() => [])
  const mdxCounts: Record<string, number> = {}
  for (const p of mdxPosts) {
    if (isSeoSpokePost(p)) continue
    const norm = normalizeCityAlias(String((p as any).city || ''))
    if (!norm) continue
    const cityId = aliasToCityId.get(norm)
    if (!cityId) continue
    mdxCounts[cityId] = (mdxCounts[cityId] || 0) + 1
  }

  const counts: Record<string, number> = {}
  for (const c of cities) {
    counts[c.id] = (dbCounts[c.id] || 0) + (mdxCounts[c.id] || 0)
  }

  return { cities, counts }
}
