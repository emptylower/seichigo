import type { PrismaClient } from '@prisma/client'
import type { SupportedLocale } from '@/lib/i18n/types'
import type {
  AnitabiBangumiCard,
  AnitabiBangumiDTO,
  AnitabiBootstrapDTO,
  AnitabiChangelogDTO,
  AnitabiMapTab,
  AnitabiNearbyPointDTO,
  AnitabiPointDTO,
  AnitabiSearchResultDTO,
} from '@/lib/anitabi/types'
import { ANITABI_TAB_LABELS, clampInt, resolveAnitabiAssetUrl, normalizeText } from '@/lib/anitabi/utils'

function pickLocalizedTitle(
  locale: SupportedLocale,
  row: {
    titleZh: string | null
    titleJaRaw: string | null
    i18n?: Array<{ title: string | null }>
  }
): string {
  if (locale !== 'zh') {
    const translated = normalizeText(row.i18n?.[0]?.title)
    if (translated) return translated
  }
  return normalizeText(row.titleZh) || normalizeText(row.titleJaRaw) || '#'
}

function toCard(
  locale: SupportedLocale,
  row: {
    id: number
    titleZh: string | null
    titleJaRaw: string | null
    cat: string | null
    city: string | null
    cover: string | null
    color: string | null
    sourceModifiedMs: bigint | null
    mapEnabled: boolean
    geoLat: number | null
    geoLng: number | null
    zoom: number | null
    i18n: Array<{ title: string | null }>
    meta: {
      pointsLength: number
      imagesLength: number
    } | null
  }
): AnitabiBangumiCard {
  return {
    id: row.id,
    title: pickLocalizedTitle(locale, row),
    titleZh: row.titleZh,
    cat: row.cat,
    city: row.city,
    cover: resolveAnitabiAssetUrl(row.cover),
    color: row.color,
    pointsLength: row.meta?.pointsLength || 0,
    imagesLength: row.meta?.imagesLength || 0,
    sourceModifiedMs: row.sourceModifiedMs == null ? null : Number(row.sourceModifiedMs),
    mapEnabled: row.mapEnabled,
    geo: row.geoLat != null && row.geoLng != null ? [row.geoLat, row.geoLng] : null,
    zoom: row.zoom,
  }
}

const NEARBY_RADIUS_KM_STEPS = [25, 60, 120, 240, 480, 960]

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function distanceMeters(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const earthRadius = 6378137
  const latDelta = toRadians(toLat - fromLat)
  const lngDelta = toRadians(toLng - fromLng)
  const fromLatRad = toRadians(fromLat)
  const toLatRad = toRadians(toLat)
  const sinLat = Math.sin(latDelta / 2)
  const sinLng = Math.sin(lngDelta / 2)
  const acc = sinLat * sinLat + Math.cos(fromLatRad) * Math.cos(toLatRad) * sinLng * sinLng
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(acc)))
}

function clampLatitude(value: number): number {
  return Math.max(-90, Math.min(90, value))
}

function clampLongitude(value: number): number {
  return Math.max(-180, Math.min(180, value))
}

function buildNearbyBounds(lat: number, lng: number, radiusKm: number): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const latDelta = radiusKm / 110.574
  const cosLat = Math.max(0.1, Math.abs(Math.cos(toRadians(lat))))
  const lngDelta = radiusKm / (111.320 * cosLat)
  return {
    minLat: clampLatitude(lat - latDelta),
    maxLat: clampLatitude(lat + latDelta),
    minLng: clampLongitude(lng - lngDelta),
    maxLng: clampLongitude(lng + lngDelta),
  }
}

export async function getActiveDatasetVersion(prisma: PrismaClient): Promise<string> {
  const row = await prisma.anitabiSourceCursor.findUnique({ where: { sourceName: 'activeDatasetVersion' } })
  const value = normalizeText(row?.value)
  if (value) return value

  const latest = await prisma.anitabiBangumi.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { datasetVersion: true },
  })

  return normalizeText(latest?.datasetVersion) || 'unknown'
}

export async function listFacetCities(prisma: PrismaClient, limit = 12): Promise<string[]> {
  const rows = await prisma.anitabiBangumi.groupBy({
    by: ['city'],
    where: {
      mapEnabled: true,
      city: { not: null },
    },
    _count: { city: true },
    orderBy: {
      _count: {
        city: 'desc',
      },
    },
    take: clampInt(limit, 12, 1, 100),
  })

  return rows
    .map((row) => normalizeText(row.city))
    .filter(Boolean)
}

export async function listBangumiCards(input: {
  prisma: PrismaClient
  locale: SupportedLocale
  tab: AnitabiMapTab
  city?: string | null
  q?: string | null
  take?: number
  skip?: number
}): Promise<AnitabiBangumiCard[]> {
  const q = normalizeText(input.q)
  const city = normalizeText(input.city)

  const queryTake = input.tab === 'hot' ? Math.max((input.take ?? 18) * 4, 120) : clampInt(input.take, 18, 1, 200)

  const rows = await input.prisma.anitabiBangumi.findMany({
    where: {
      mapEnabled: true,
      ...(city ? { city } : {}),
      ...(q
        ? {
            OR: [
              { titleZh: { contains: q, mode: 'insensitive' } },
              { titleJaRaw: { contains: q, mode: 'insensitive' } },
              { city: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      meta: { select: { pointsLength: true, imagesLength: true } },
      i18n: {
        where: { language: input.locale },
        select: { title: true },
        take: 1,
      },
    },
    orderBy: input.tab === 'recent' ? [{ createdAt: 'desc' }, { sourceModifiedMs: 'desc' }] : [{ sourceModifiedMs: 'desc' }, { updatedAt: 'desc' }],
    skip: input.skip ?? 0,
    take: queryTake,
  })

  const cards = rows.map((row) => toCard(input.locale, row))
  if (input.tab === 'hot') {
    cards.sort((a, b) => {
      if (a.pointsLength !== b.pointsLength) return b.pointsLength - a.pointsLength
      return (b.sourceModifiedMs || 0) - (a.sourceModifiedMs || 0)
    })
  }
  return cards.slice(0, clampInt(input.take, 18, 1, 200))
}

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
    i18n: Array<{ name: string | null }>
  }
): AnitabiPointDTO {
  const localizedName = locale === 'zh' ? null : normalizeText(row.i18n?.[0]?.name)

  return {
    id: row.id,
    bangumiId: row.bangumiId,
    name: localizedName || row.name,
    nameZh: row.nameZh,
    geo: row.geoLat != null && row.geoLng != null ? [row.geoLat, row.geoLng] : null,
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
            select: { name: true },
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
    i18n: row.i18n.map((it) => ({ title: it.title })),
  })

  if (row.i18n[0]?.city) {
    card.city = row.i18n[0].city
  }

  const points = row.points.map((point) =>
    toPointDto(input.locale, {
      ...point,
      i18n: point.i18n.map((it) => ({ name: it.name })),
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

export async function listChangelog(prisma: PrismaClient, take = 80): Promise<AnitabiChangelogDTO[]> {
  const rows = await prisma.anitabiChangelogEntry.findMany({
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: clampInt(take, 80, 1, 500),
  })

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    title: row.title,
    body: row.body,
    links: Array.isArray(row.linksJson) ? (row.linksJson as Array<{ label: string; url: string }>) : [],
  }))
}

export async function getBootstrap(input: {
  prisma: PrismaClient
  locale: SupportedLocale
  tab: AnitabiMapTab
  city?: string | null
  q?: string | null
}): Promise<AnitabiBootstrapDTO> {
  const [datasetVersion, cards, cities, changelog] = await Promise.all([
    getActiveDatasetVersion(input.prisma),
    listBangumiCards({
      prisma: input.prisma,
      locale: input.locale,
      tab: input.tab,
      city: input.city,
      q: input.q,
      take: 18,
    }),
    listFacetCities(input.prisma),
    listChangelog(input.prisma, 8),
  ])

  return {
    datasetVersion,
    tab: input.tab,
    tabs: [
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
  const q = normalizeText(input.q)
  if (!q) return { bangumi: [], points: [], cities: [] }

  const [bangumiRows, pointRows, cityRows] = await Promise.all([
    input.prisma.anitabiBangumi.findMany({
      where: {
        mapEnabled: true,
        OR: [
          { titleZh: { contains: q, mode: 'insensitive' } },
          { titleJaRaw: { contains: q, mode: 'insensitive' } },
          { city: { contains: q, mode: 'insensitive' } },
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
        ],
      },
      include: {
        i18n: {
          where: { language: input.locale },
          select: { name: true },
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

  return {
    bangumi: bangumiRows.map((row) => toCard(input.locale, row)),
    points: pointRows.map((row) => toPointDto(input.locale, row)),
    cities: cityRows.map((row) => normalizeText(row.city)).filter(Boolean),
  }
}

export async function listNearbyPoints(input: {
  prisma: PrismaClient
  locale: SupportedLocale
  lat: number
  lng: number
  city?: string | null
  q?: string | null
  limit?: number
}): Promise<AnitabiNearbyPointDTO[]> {
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return []

  const limit = clampInt(input.limit, 12, 1, 40)
  const city = normalizeText(input.city)
  const q = normalizeText(input.q)
  const qWhere = q
    ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { nameZh: { contains: q, mode: 'insensitive' as const } },
          { mark: { contains: q, mode: 'insensitive' as const } },
          { bangumi: { titleZh: { contains: q, mode: 'insensitive' as const } } },
          { bangumi: { titleJaRaw: { contains: q, mode: 'insensitive' as const } } },
          { bangumi: { city: { contains: q, mode: 'insensitive' as const } } },
        ],
      }
    : {}

  const sharedSelect = {
    id: true,
    bangumiId: true,
    name: true,
    geoLat: true,
    geoLng: true,
    image: true,
    i18n: {
      where: { language: input.locale },
      select: { name: true },
      take: 1,
    },
    bangumi: {
      select: {
        titleZh: true,
        titleJaRaw: true,
        city: true,
        i18n: {
          where: { language: input.locale },
          select: { title: true },
          take: 1,
        },
      },
    },
  } as const

  type NearbyCandidate = {
    id: string
    bangumiId: number
    name: string
    geoLat: number | null
    geoLng: number | null
    image: string | null
    i18n: Array<{ name: string | null }>
    bangumi: {
      titleZh: string | null
      titleJaRaw: string | null
      city: string | null
      i18n: Array<{ title: string | null }>
    }
  }
  const candidateById = new Map<string, NearbyCandidate>()

  for (const radiusKm of NEARBY_RADIUS_KM_STEPS) {
    const bounds = buildNearbyBounds(input.lat, input.lng, radiusKm)
    const rows = await input.prisma.anitabiPoint.findMany({
      where: {
        geoLat: {
          not: null,
          gte: bounds.minLat,
          lte: bounds.maxLat,
        },
        geoLng: {
          not: null,
          gte: bounds.minLng,
          lte: bounds.maxLng,
        },
        bangumi: {
          mapEnabled: true,
          ...(city ? { city } : {}),
        },
        ...qWhere,
      },
      select: sharedSelect,
    })
    for (const row of rows) {
      candidateById.set(row.id, row)
    }
    if (candidateById.size >= limit * 6) break
  }

  if (candidateById.size < limit) {
    const fallbackRows = await input.prisma.anitabiPoint.findMany({
      where: {
        geoLat: { not: null },
        geoLng: { not: null },
        bangumi: {
          mapEnabled: true,
          ...(city ? { city } : {}),
        },
        ...qWhere,
      },
      select: sharedSelect,
    })
    for (const row of fallbackRows) {
      candidateById.set(row.id, row)
    }
  }

  return Array.from(candidateById.values())
    .map((row) => {
      if (row.geoLat == null || row.geoLng == null) return null
      const localizedName = input.locale === 'zh' ? null : normalizeText(row.i18n?.[0]?.name)
      return {
        id: row.id,
        bangumiId: row.bangumiId,
        bangumiTitle: pickLocalizedTitle(input.locale, row.bangumi),
        city: row.bangumi.city,
        name: localizedName || row.name,
        geo: [row.geoLat, row.geoLng],
        distanceMeters: distanceMeters(input.lat, input.lng, row.geoLat, row.geoLng),
        image: resolveAnitabiAssetUrl(row.image),
      } satisfies AnitabiNearbyPointDTO
    })
    .filter((row): row is AnitabiNearbyPointDTO => Boolean(row))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit)
}

export async function listChunk(input: {
  prisma: PrismaClient
  locale: SupportedLocale
  tab: AnitabiMapTab
  index: number
  size?: number
  city?: string | null
  q?: string | null
}): Promise<AnitabiBangumiCard[]> {
  const size = clampInt(input.size, 100, 20, 200)
  const index = clampInt(input.index, 0, 0, 999)
  return await listBangumiCards({
    prisma: input.prisma,
    locale: input.locale,
    tab: input.tab,
    city: input.city,
    q: input.q,
    take: size,
    skip: index * size,
  })
}
