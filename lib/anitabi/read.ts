import type { Prisma, PrismaClient } from '@prisma/client'
import type { SupportedLocale } from '@/lib/i18n/types'
import type {
  AnitabiBangumiCard,
  AnitabiBangumiDTO,
  AnitabiBootstrapDTO,
  AnitabiChangelogDTO,
  AnitabiMapTab,
  AnitabiPointDTO,
  AnitabiSearchResultDTO,
} from '@/lib/anitabi/types'
import { ANITABI_TAB_LABELS, clampInt, resolveAnitabiAssetUrl, normalizeText } from '@/lib/anitabi/utils'
import { getRecentHotSnapshot, resolveHotScore } from '@/lib/anitabi/hotRank'

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
    nearestDistanceMeters: null,
  }
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const earthRadius = 6378137
  const latDelta = toRadians(b.lat - a.lat)
  const lngDelta = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const sinLat = Math.sin(latDelta / 2)
  const sinLng = Math.sin(lngDelta / 2)
  const m = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(m)))
}

function buildBangumiWhere(city: string, q: string): Prisma.AnitabiBangumiWhereInput {
  return {
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
  }
}

function buildCardInclude(locale: SupportedLocale): Prisma.AnitabiBangumiInclude {
  return {
    meta: { select: { pointsLength: true, imagesLength: true } },
    i18n: {
      where: { language: locale },
      select: { title: true },
      take: 1,
    },
  }
}

type HotSignalSeed = {
  titles: string[]
  years: number[]
}

function addUniqueTitle(target: HotSignalSeed, input: unknown) {
  const text = normalizeText(input)
  if (!text) return
  if (target.titles.includes(text)) return
  if (target.titles.length >= 24) return
  target.titles.push(text)
}

function addUniqueYear(target: HotSignalSeed, input: unknown) {
  const n = Number(input)
  if (!Number.isFinite(n)) return
  const year = Math.trunc(n)
  if (year < 1900 || year > 2200) return
  if (target.years.includes(year)) return
  if (target.years.length >= 4) return
  target.years.push(year)
}

async function getHotSignalsByBangumiId(prisma: PrismaClient, bangumiIds: number[]): Promise<Map<number, HotSignalSeed>> {
  const ids = Array.from(new Set(bangumiIds.filter((id) => Number.isFinite(id))))
  if (!ids.length) return new Map()

  const rows = await prisma.anitabiMapping.findMany({
    where: {
      bangumiId: { in: ids },
      animeId: { not: null },
    },
    select: {
      bangumiId: true,
      anime: {
        select: {
          name: true,
          name_ja: true,
          name_en: true,
          alias: true,
          year: true,
        },
      },
    },
  })

  const out = new Map<number, HotSignalSeed>()
  const ensure = (bangumiId: number) => {
    const existing = out.get(bangumiId)
    if (existing) return existing
    const next: HotSignalSeed = { titles: [], years: [] }
    out.set(bangumiId, next)
    return next
  }

  for (const row of rows) {
    if (!row.anime) continue
    const target = ensure(row.bangumiId)
    addUniqueTitle(target, row.anime.name)
    addUniqueTitle(target, row.anime.name_ja)
    addUniqueTitle(target, row.anime.name_en)
    for (const alias of row.anime.alias || []) {
      addUniqueTitle(target, alias)
    }
    addUniqueYear(target, row.anime.year)
  }

  return out
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
  userLocation?: { lat: number; lng: number } | null
  take?: number
  skip?: number
}): Promise<AnitabiBangumiCard[]> {
  const q = normalizeText(input.q)
  const city = normalizeText(input.city)
  const take = clampInt(input.take, 18, 1, 200)
  const skip = clampInt(input.skip, 0, 0, 9999)
  const bangumiWhere = buildBangumiWhere(city, q)

  if (input.tab === 'nearby') {
    if (!input.userLocation) return []

    const nearPointRows = await input.prisma.anitabiPoint.findMany({
      where: {
        geoLat: { not: null },
        geoLng: { not: null },
        bangumi: {
          is: bangumiWhere,
        },
      },
      select: {
        bangumiId: true,
        geoLat: true,
        geoLng: true,
      },
    })

    const minDistanceByBangumi = new Map<number, number>()
    for (const row of nearPointRows) {
      if (row.geoLat == null || row.geoLng == null) continue
      const meters = distanceMeters(input.userLocation, { lat: row.geoLat, lng: row.geoLng })
      const prev = minDistanceByBangumi.get(row.bangumiId)
      if (prev == null || meters < prev) {
        minDistanceByBangumi.set(row.bangumiId, meters)
      }
    }

    const sortedBangumi = Array.from(minDistanceByBangumi.entries()).sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1]
      return a[0] - b[0]
    })

    const page = sortedBangumi.slice(skip, skip + take)
    if (!page.length) return []

    const pagedIds = page.map(([bangumiId]) => bangumiId)
    const rows = await input.prisma.anitabiBangumi.findMany({
      where: { id: { in: pagedIds } },
      include: buildCardInclude(input.locale),
    })

    const rowById = new Map(rows.map((row) => [row.id, row]))
    const cards: AnitabiBangumiCard[] = []
    for (const [bangumiId, distance] of page) {
      const row = rowById.get(bangumiId)
      if (!row) continue
      const card = toCard(input.locale, row)
      card.nearestDistanceMeters = Math.round(distance)
      cards.push(card)
    }
    return cards
  }

  const queryTake = input.tab === 'hot' ? Math.max(take * 4, 120) : take

  const rows = await input.prisma.anitabiBangumi.findMany({
    where: bangumiWhere,
    include: buildCardInclude(input.locale),
    orderBy: input.tab === 'recent' ? [{ createdAt: 'desc' }, { sourceModifiedMs: 'desc' }] : [{ sourceModifiedMs: 'desc' }, { updatedAt: 'desc' }],
    skip,
    take: queryTake,
  })

  const cards = rows.map((row) => toCard(input.locale, row))
  if (input.tab === 'hot') {
    const [hotSnapshot, hotSignalsByBangumiId] = await Promise.all([
      getRecentHotSnapshot().catch(() => null),
      getHotSignalsByBangumiId(input.prisma, rows.map((row) => row.id)).catch(() => new Map<number, HotSignalSeed>()),
    ])

    const ranked = rows.map((row, idx) => {
      const seed = hotSignalsByBangumiId.get(row.id) || { titles: [], years: [] }
      const titles = [row.titleJaRaw, row.titleZh, ...seed.titles].map((x) => normalizeText(x)).filter(Boolean)
      const hotScore = resolveHotScore(hotSnapshot, { titles, years: seed.years })
      return { card: cards[idx]!, hotScore }
    })

    ranked.sort((a, b) => {
      const aHasScore = Number.isFinite(a.hotScore)
      const bHasScore = Number.isFinite(b.hotScore)
      if (aHasScore && !bHasScore) return -1
      if (!aHasScore && bHasScore) return 1
      if (aHasScore && bHasScore && a.hotScore !== b.hotScore) return (b.hotScore || 0) - (a.hotScore || 0)

      if (a.card.pointsLength !== b.card.pointsLength) return b.card.pointsLength - a.card.pointsLength
      return (b.card.sourceModifiedMs || 0) - (a.card.sourceModifiedMs || 0)
    })
    return ranked.map((item) => item.card).slice(0, take)
  }
  return cards.slice(0, take)
}

export async function listAllBangumiCards(input: {
  prisma: PrismaClient
  locale: SupportedLocale
  tab: Exclude<AnitabiMapTab, 'nearby'>
}): Promise<AnitabiBangumiCard[]> {
  const bangumiWhere = buildBangumiWhere('', '')

  const rows = await input.prisma.anitabiBangumi.findMany({
    where: bangumiWhere,
    include: buildCardInclude(input.locale),
    orderBy: input.tab === 'recent' ? [{ createdAt: 'desc' }, { sourceModifiedMs: 'desc' }] : [{ sourceModifiedMs: 'desc' }, { updatedAt: 'desc' }],
  })

  const cards = rows.map((row) => toCard(input.locale, row))

  if (input.tab === 'hot') {
    const [hotSnapshot, hotSignalsByBangumiId] = await Promise.all([
      getRecentHotSnapshot().catch(() => null),
      getHotSignalsByBangumiId(input.prisma, rows.map((row) => row.id)).catch(() => new Map<number, HotSignalSeed>()),
    ])

    const ranked = rows.map((row, idx) => {
      const seed = hotSignalsByBangumiId.get(row.id) || { titles: [], years: [] }
      const titles = [row.titleJaRaw, row.titleZh, ...seed.titles].map((x) => normalizeText(x)).filter(Boolean)
      const hotScore = resolveHotScore(hotSnapshot, { titles, years: seed.years })
      return { card: cards[idx]!, hotScore }
    })

    ranked.sort((a, b) => {
      const aHasScore = Number.isFinite(a.hotScore)
      const bHasScore = Number.isFinite(b.hotScore)
      if (aHasScore && !bHasScore) return -1
      if (!aHasScore && bHasScore) return 1
      if (aHasScore && bHasScore && a.hotScore !== b.hotScore) return (b.hotScore || 0) - (a.hotScore || 0)

      if (a.card.pointsLength !== b.card.pointsLength) return b.card.pointsLength - a.card.pointsLength
      return (b.card.sourceModifiedMs || 0) - (a.card.sourceModifiedMs || 0)
    })
    return ranked.map((item) => item.card)
  }

  return cards
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
    i18n: Array<{ name: string | null; note: string | null }>
  }
): AnitabiPointDTO {
  const localizedName = locale === 'zh' ? null : normalizeText(row.i18n?.[0]?.name)
  const localizedNote = locale === 'zh' ? null : normalizeText(row.i18n?.[0]?.note)

  return {
    id: row.id,
    bangumiId: row.bangumiId,
    name: localizedName || row.name,
    nameZh: row.nameZh,
    note: localizedNote || row.mark,
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
    i18n: row.i18n.map((it) => ({ title: it.title })),
  })

  if (row.i18n[0]?.city) {
    card.city = row.i18n[0].city
  }

  const points = row.points.map((point) =>
    toPointDto(input.locale, {
      ...point,
      i18n: point.i18n.map((it) => ({ name: it.name, note: it.note })),
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

  return {
    bangumi: bangumiRows.map((row) => toCard(input.locale, row)),
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
}): Promise<AnitabiBangumiCard[]> {
  const size = clampInt(input.size, 100, 20, 200)
  const index = clampInt(input.index, 0, 0, 999)
  return await listBangumiCards({
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
