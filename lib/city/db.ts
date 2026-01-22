import { prisma } from '@/lib/db/prisma'

export type CityLite = {
  id: string
  slug: string
  name_zh: string
  name_en: string | null
  name_ja: string | null
  description_zh: string | null
  description_en: string | null
  transportTips_zh: string | null
  transportTips_en: string | null
  cover: string | null
  needsReview: boolean
  hidden: boolean
}

export async function getCityBySlug(slug: string): Promise<CityLite | null> {
  const key = String(slug || '').trim()
  if (!key) return null
  const city = await prisma.city.findUnique({
    where: { slug: key },
    select: {
      id: true,
      slug: true,
      name_zh: true,
      name_en: true,
      name_ja: true,
      description_zh: true,
      description_en: true,
      transportTips_zh: true,
      transportTips_en: true,
      cover: true,
      needsReview: true,
      hidden: true,
    },
  })
  return city || null
}

export async function getCityBySlugOrRedirect(
  slug: string
): Promise<{ city: CityLite | null; redirectToSlug: string | null }> {
  const key = String(slug || '').trim()
  if (!key) return { city: null, redirectToSlug: null }

  const city = await getCityBySlug(key)
  if (city) return { city, redirectToSlug: null }

  const redirect = await prisma.cityRedirect.findUnique({
    where: { fromSlug: key },
    select: { toCityId: true },
  })
  if (!redirect?.toCityId) return { city: null, redirectToSlug: null }

  const target = await prisma.city.findUnique({
    where: { id: redirect.toCityId },
    select: {
      id: true,
      slug: true,
      name_zh: true,
      name_en: true,
      name_ja: true,
      description_zh: true,
      description_en: true,
      transportTips_zh: true,
      transportTips_en: true,
      cover: true,
      needsReview: true,
      hidden: true,
    },
  })

  return { city: target || null, redirectToSlug: target?.slug || null }
}

export async function listCitiesForIndex(): Promise<CityLite[]> {
  return prisma.city.findMany({
    where: { hidden: false },
    orderBy: { name_zh: 'asc' },
    select: {
      id: true,
      slug: true,
      name_zh: true,
      name_en: true,
      name_ja: true,
      description_zh: true,
      description_en: true,
      transportTips_zh: true,
      transportTips_en: true,
      cover: true,
      needsReview: true,
      hidden: true,
    },
  })
}

export async function countPublishedArticlesByCityIds(cityIds: string[]): Promise<Record<string, number>> {
  const ids = Array.isArray(cityIds) ? cityIds.filter(Boolean) : []
  if (!ids.length) return {}

  const grouped = await prisma.articleCity.groupBy({
    by: ['cityId'],
    where: {
      cityId: { in: ids },
      article: { status: 'published' },
    },
    _count: { _all: true },
  })

  const counts: Record<string, number> = {}
  for (const g of grouped) {
    counts[g.cityId] = g._count._all
  }
  return counts
}
