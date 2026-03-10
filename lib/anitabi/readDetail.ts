import type { PrismaClient } from '@prisma/client'
import type {
  AnitabiBangumiDTO,
  AnitabiBootstrapDTO,
  AnitabiChangelogDTO,
  AnitabiMapTab,
  AnitabiPointDTO,
  AnitabiSearchResultDTO,
} from '@/lib/anitabi/types'
import type { SupportedLocale } from '@/lib/i18n/types'
import { ANITABI_TAB_LABELS, clampInt, normalizeText } from '@/lib/anitabi/utils'
import { toCard } from '@/lib/anitabi/readTransforms'
import {
  buildCardInclude,
  getActiveDatasetVersion,
  listBangumiCards,
  listFacetCities,
} from '@/lib/anitabi/readCards'

function toPointDto(
  locale: SupportedLocale,
  row: {
    id: string
    bangumiId: number
    name: string
    nameZh: string | null
    geoLat: number | null
    geoLng: number | null
    ep: string | null
    s: string | null
    image: string | null
    origin: string | null
    originUrl: string | null
    originLink: string | null
    density: number | null
    mark: string | null
    i18n: Array<{ name: string | null; note: string | null }>
  }
): AnitabiPointDTO {
  const localizedName = normalizeText(row.i18n?.[0]?.name)
  const localizedNote = normalizeText(row.i18n?.[0]?.note)

  return {
    id: row.id,
    bangumiId: row.bangumiId,
    name: localizedName || row.name,
    nameZh: row.nameZh,
    note: localizedNote || row.mark,
    geo:
      row.geoLat != null && row.geoLng != null ? [row.geoLat, row.geoLng] : null,
    ep: row.ep,
    s: row.s,
    image: row.image,
    origin: row.origin,
    originUrl: row.originUrl,
    originLink: row.originLink,
    density: row.density,
    mark: row.mark,
  }
}

export async function getBangumiDetail(input: {
  prisma: PrismaClient
  id: number
  locale: SupportedLocale
}): Promise<AnitabiBangumiDTO | null> {
  const row = await input.prisma.anitabiBangumi.findUnique({
    where: { id: input.id },
    include: {
      i18n: {
        where: { language: input.locale },
        select: { title: true, description: true, city: true },
        take: 1,
      },
      meta: true,
      points: {
        include: {
          i18n: {
            where: { language: input.locale },
            select: { name: true, note: true },
            take: 1,
          },
        },
        orderBy: [{ ep: 'asc' }, { updatedAt: 'desc' }],
      },
    },
  })

  if (!row) return null

  const card = toCard(input.locale, {
    ...row,
    i18n: row.i18n.map((item) => ({ title: item.title })),
  })
  if (row.i18n[0]?.city) {
    card.city = row.i18n[0].city
  }

  const points = row.points.map((point) =>
    toPointDto(input.locale, {
      ...point,
      i18n: point.i18n.map((item) => ({ name: item.name, note: item.note })),
    })
  )

  const contributorCount = new Map<string, number>()
  for (const point of points) {
    const key = normalizeText(point.origin)
    if (!key) continue
    contributorCount.set(key, (contributorCount.get(key) || 0) + 1)
  }

  const contributors = Array.from(contributorCount.entries())
    .map(([key, count]) => ({
      id: key,
      name: key,
      avatar: null,
      link: null,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  return {
    card,
    description: normalizeText(row.i18n[0]?.description) || row.description,
    tags: row.tags || [],
    points,
    customEpNames: (row.meta?.customEpNamesJson as Record<string, string>) || {},
    theme: row.meta?.themeJson || null,
    contributors,
  }
}

export async function listChangelog(
  prisma: PrismaClient,
  take = 80
): Promise<AnitabiChangelogDTO[]> {
  const rows = await prisma.anitabiChangelogEntry.findMany({
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: clampInt(take, 80, 1, 500),
  })

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    title: row.title,
    body: row.body,
    links: Array.isArray(row.linksJson)
      ? (row.linksJson as Array<{ label: string; url: string }>)
      : [],
  }))
}

export async function getBootstrap(input: {
  prisma: PrismaClient
  locale: SupportedLocale
  tab: AnitabiMapTab
  city?: string | null
  q?: string | null
  userLocation?: { lat: number; lng: number } | null
}): Promise<AnitabiBootstrapDTO> {
  const [datasetVersion, cards, cities, changelog] = await Promise.all([
    getActiveDatasetVersion(input.prisma),
    listBangumiCards({
      prisma: input.prisma,
      locale: input.locale,
      tab: input.tab,
      city: input.city,
      q: input.q,
      userLocation: input.userLocation,
      take: 18,
    }),
    listFacetCities(input.prisma),
    listChangelog(input.prisma, 8),
  ])

  return {
    datasetVersion,
    tab: input.tab,
    tabs: [
      { key: 'nearby', label: ANITABI_TAB_LABELS[input.locale].nearby },
      { key: 'latest', label: ANITABI_TAB_LABELS[input.locale].latest },
      { key: 'recent', label: ANITABI_TAB_LABELS[input.locale].recent },
      { key: 'hot', label: ANITABI_TAB_LABELS[input.locale].hot },
    ],
    facets: { cities },
    cards,
    changelog,
  }
}

export async function searchDataset(input: {
  prisma: PrismaClient
  locale: SupportedLocale
  q: string
}): Promise<AnitabiSearchResultDTO> {
  const q = normalizeText(input.q).toLowerCase()
  if (!q) return { bangumi: [], points: [], cities: [] }

  const [bangumiRows, pointRows, cityRows] = await Promise.all([
    input.prisma.anitabiBangumi.findMany({
      where: {
        mapEnabled: true,
        OR: [
          { titleZh: { contains: q, mode: 'insensitive' } },
          { titleJaRaw: { contains: q, mode: 'insensitive' } },
          { city: { contains: q, mode: 'insensitive' } },
          { i18n: { some: { language: input.locale, title: { contains: q, mode: 'insensitive' } } } },
          { titleOriginal: { contains: q, mode: 'insensitive' } },
          { titleRomaji: { contains: q, mode: 'insensitive' } },
          { titleEnglish: { contains: q, mode: 'insensitive' } },
          { aliases: { has: q } },
        ],
      },
      include: {
        meta: { select: { pointsLength: true, imagesLength: true } },
        i18n: {
          where: { language: input.locale },
          select: { title: true },
          take: 1,
        },
      },
      take: 20,
      orderBy: [{ sourceModifiedMs: 'desc' }],
    }),
    input.prisma.anitabiPoint.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { nameZh: { contains: q, mode: 'insensitive' } },
          { mark: { contains: q, mode: 'insensitive' } },
          { i18n: { some: { name: { contains: q, mode: 'insensitive' } } } },
          { i18n: { some: { note: { contains: q, mode: 'insensitive' } } } },
        ],
      },
      include: {
        i18n: {
          where: { language: input.locale },
          select: { name: true, note: true },
          take: 1,
        },
      },
      take: 30,
      orderBy: [{ updatedAt: 'desc' }],
    }),
    input.prisma.anitabiBangumi.groupBy({
      by: ['city'],
      where: {
        city: { contains: q, mode: 'insensitive' },
        mapEnabled: true,
      },
      _count: { city: true },
      orderBy: {
        _count: {
          city: 'desc',
        },
      },
      take: 20,
    }),
  ])

  const seenBangumiIds = new Set<number>()
  const uniqueBangumi = bangumiRows
    .filter((row) => {
      if (seenBangumiIds.has(row.id)) return false
      seenBangumiIds.add(row.id)
      return true
    })
    .map((row) => toCard(input.locale, row))

  return {
    bangumi: uniqueBangumi,
    points: pointRows.map((row) => toPointDto(input.locale, row)),
    cities: cityRows.map((row) => normalizeText(row.city)).filter(Boolean),
  }
}

export async function listChunk(input: {
  prisma: PrismaClient
  locale: SupportedLocale
  tab: AnitabiMapTab
  index: number
  size?: number
  city?: string | null
  q?: string | null
  userLocation?: { lat: number; lng: number } | null
}): Promise<ReturnType<typeof listBangumiCards>> {
  const size = clampInt(input.size, 100, 20, 200)
  const index = clampInt(input.index, 0, 0, 999)
  return listBangumiCards({
    prisma: input.prisma,
    locale: input.locale,
    tab: input.tab,
    city: input.city,
    q: input.q,
    userLocation: input.userLocation,
    take: size,
    skip: index * size,
  })
}
