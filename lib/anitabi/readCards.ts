import type { Prisma, PrismaClient } from '@prisma/client'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { AnitabiBangumiCard, AnitabiMapTab } from '@/lib/anitabi/types'
import { clampInt, normalizeText } from '@/lib/anitabi/utils'
import { getRecentHotSnapshot, resolveHotScore } from '@/lib/anitabi/hotRank'
import { distanceMeters, toCard } from '@/lib/anitabi/readTransforms'

export function buildBangumiWhere(input: {
  city?: string
  q?: string
  locale?: SupportedLocale
}): Prisma.AnitabiBangumiWhereInput {
  const city = normalizeText(input.city)
  const q = normalizeText(input.q).toLowerCase()
  const locale = input.locale
  return {
    mapEnabled: true,
    ...(city ? { city } : {}),
    ...(q
      ? {
          OR: [
            { titleZh: { contains: q, mode: 'insensitive' } },
            { titleJaRaw: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
            {
              i18n: {
                some: {
                  ...(locale ? { language: locale } : {}),
                  title: { contains: q, mode: 'insensitive' },
                },
              },
            },
            { titleOriginal: { contains: q, mode: 'insensitive' } },
            { titleRomaji: { contains: q, mode: 'insensitive' } },
            { titleEnglish: { contains: q, mode: 'insensitive' } },
            { aliases: { has: q } },
          ],
        }
      : {}),
  }
}

export function buildCardInclude(
  locale: SupportedLocale
): Prisma.AnitabiBangumiInclude {
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

async function getHotSignalsByBangumiId(
  prisma: PrismaClient,
  bangumiIds: number[]
): Promise<Map<number, HotSignalSeed>> {
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

export async function getActiveDatasetVersion(
  prisma: PrismaClient
): Promise<string> {
  const row = await prisma.anitabiSourceCursor.findUnique({
    where: { sourceName: 'activeDatasetVersion' },
  })
  const value = normalizeText(row?.value)
  if (value) return value

  const latest = await prisma.anitabiBangumi.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { datasetVersion: true },
  })

  return normalizeText(latest?.datasetVersion) || 'unknown'
}

export async function listFacetCities(
  prisma: PrismaClient,
  limit = 12
): Promise<string[]> {
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

  return rows.map((row) => normalizeText(row.city)).filter(Boolean)
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
  const bangumiWhere = buildBangumiWhere({ city, q, locale: input.locale })

  if (input.tab === 'nearby') {
    if (!input.userLocation) return []

    const nearPointRows = await input.prisma.anitabiPoint.findMany({
      where: {
        geoLat: { not: null },
        geoLng: { not: null },
        bangumi: { is: bangumiWhere },
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
      const meters = distanceMeters(input.userLocation, {
        lat: row.geoLat,
        lng: row.geoLng,
      })
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
    orderBy:
      input.tab === 'recent'
        ? [{ createdAt: 'desc' }, { sourceModifiedMs: 'desc' }]
        : [{ sourceModifiedMs: 'desc' }, { updatedAt: 'desc' }],
    skip,
    take: queryTake,
  })

  const cards = rows.map((row) => toCard(input.locale, row))
  if (input.tab === 'hot') {
    const [hotSnapshot, hotSignalsByBangumiId] = await Promise.all([
      getRecentHotSnapshot().catch(() => null),
      getHotSignalsByBangumiId(
        input.prisma,
        rows.map((row) => row.id)
      ).catch(() => new Map<number, HotSignalSeed>()),
    ])

    const ranked = rows.map((row, idx) => {
      const seed = hotSignalsByBangumiId.get(row.id) || { titles: [], years: [] }
      const titles = [row.titleJaRaw, row.titleZh, ...seed.titles]
        .map((value) => normalizeText(value))
        .filter(Boolean)
      const hotScore = resolveHotScore(hotSnapshot, {
        titles,
        years: seed.years,
      })
      return { card: cards[idx]!, hotScore }
    })

    ranked.sort((a, b) => {
      const aHasScore = Number.isFinite(a.hotScore)
      const bHasScore = Number.isFinite(b.hotScore)
      if (aHasScore && !bHasScore) return -1
      if (!aHasScore && bHasScore) return 1
      if (aHasScore && bHasScore && a.hotScore !== b.hotScore) {
        return (b.hotScore || 0) - (a.hotScore || 0)
      }
      if (a.card.pointsLength !== b.card.pointsLength) {
        return b.card.pointsLength - a.card.pointsLength
      }
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
  city?: string | null
  q?: string | null
}): Promise<{ items: AnitabiBangumiCard[]; total: number }> {
  const q = normalizeText(input.q)
  const city = normalizeText(input.city)
  const bangumiWhere = buildBangumiWhere({ city, q, locale: input.locale })

  const [rows, total] = await Promise.all([
    input.prisma.anitabiBangumi.findMany({
      where: bangumiWhere,
      include: buildCardInclude(input.locale),
      orderBy:
        input.tab === 'recent'
          ? [{ createdAt: 'desc' }, { sourceModifiedMs: 'desc' }]
          : [{ sourceModifiedMs: 'desc' }, { updatedAt: 'desc' }],
    }),
    input.prisma.anitabiBangumi.count({ where: bangumiWhere }),
  ])

  const cards = rows.map((row) => toCard(input.locale, row))
  if (input.tab === 'hot') {
    const [hotSnapshot, hotSignalsByBangumiId] = await Promise.all([
      getRecentHotSnapshot().catch(() => null),
      getHotSignalsByBangumiId(
        input.prisma,
        rows.map((row) => row.id)
      ).catch(() => new Map<number, HotSignalSeed>()),
    ])

    const ranked = rows.map((row, idx) => {
      const seed = hotSignalsByBangumiId.get(row.id) || { titles: [], years: [] }
      const titles = [row.titleJaRaw, row.titleZh, ...seed.titles]
        .map((value) => normalizeText(value))
        .filter(Boolean)
      const hotScore = resolveHotScore(hotSnapshot, {
        titles,
        years: seed.years,
      })
      return { card: cards[idx]!, hotScore }
    })

    ranked.sort((a, b) => {
      const aHasScore = Number.isFinite(a.hotScore)
      const bHasScore = Number.isFinite(b.hotScore)
      if (aHasScore && !bHasScore) return -1
      if (!aHasScore && bHasScore) return 1
      if (aHasScore && bHasScore && a.hotScore !== b.hotScore) {
        return (b.hotScore || 0) - (a.hotScore || 0)
      }
      if (a.card.pointsLength !== b.card.pointsLength) {
        return b.card.pointsLength - a.card.pointsLength
      }
      return (b.card.sourceModifiedMs || 0) - (a.card.sourceModifiedMs || 0)
    })

    return { items: ranked.map((item) => item.card), total }
  }

  return { items: cards, total }
}
