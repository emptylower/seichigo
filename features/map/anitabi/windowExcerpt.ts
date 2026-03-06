import type { AnitabiBangumiCard, AnitabiPreloadChunkItemDTO, AnitabiPreloadChunkPointDTO } from '@/lib/anitabi/types'
import { distanceMeters } from './geo'

export type WindowExcerptPointItem = {
  bangumiId: number
  bangumiTitle: string
  bangumiColor: string
  pointId: string
  pointName: string
  ep: string | null
  s: string | null
  imageUrl: string
  distanceMeters: number
}

export type WindowExcerptBangumiItem = {
  bangumiId: number
  title: string
  coverUrl: string | null
  color: string
  count: number
  nearestDistanceMeters: number
}

type VisiblePointKey = {
  bangumiId: number
  pointId: string
}

type ComputeWindowExcerptOptions = {
  center: [number, number]
  visiblePointKeys: VisiblePointKey[]
  warmPointIndexByBangumiId: Map<number, AnitabiPreloadChunkItemDTO>
  allCards: Map<number, AnitabiBangumiCard>
  maxPointItems: number
  maxBangumiItems: number
}

function isValidPoint(point: AnitabiPreloadChunkPointDTO | undefined): point is AnitabiPreloadChunkPointDTO & {
  geo: [number, number]
  image: string
} {
  if (!point?.geo || point.geo.length < 2) return false
  if (!Number.isFinite(point.geo[0]) || !Number.isFinite(point.geo[1])) return false
  if (typeof point.image !== 'string' || point.image.trim().length === 0) return false
  return true
}

export function computeWindowExcerpt({
  center,
  visiblePointKeys,
  warmPointIndexByBangumiId,
  allCards,
  maxPointItems,
  maxBangumiItems,
}: ComputeWindowExcerptOptions): {
  points: WindowExcerptPointItem[]
  bangumis: WindowExcerptBangumiItem[]
} {
  const seen = new Set<string>()
  const points: WindowExcerptPointItem[] = []
  const bangumiAgg = new Map<number, WindowExcerptBangumiItem>()

  for (const key of visiblePointKeys) {
    const uniqueKey = `${key.bangumiId}:${key.pointId}`
    if (seen.has(uniqueKey)) continue
    seen.add(uniqueKey)

    const chunk = warmPointIndexByBangumiId.get(key.bangumiId)
    const point = chunk?.points.find((item) => item.id === key.pointId)
    if (!isValidPoint(point)) continue

    const card = allCards.get(key.bangumiId)
    const distance = distanceMeters(center, [point.geo[1], point.geo[0]])
    const title = card?.titleZh || card?.title || String(key.bangumiId)
    const color = card?.color || '#ec4899'

    points.push({
      bangumiId: key.bangumiId,
      bangumiTitle: title,
      bangumiColor: color,
      pointId: key.pointId,
      pointName: point.nameZh || point.name,
      ep: point.ep,
      s: point.s,
      imageUrl: point.image.trim(),
      distanceMeters: distance,
    })

    const existing = bangumiAgg.get(key.bangumiId)
    if (existing) {
      existing.count += 1
      if (distance < existing.nearestDistanceMeters) {
        existing.nearestDistanceMeters = distance
      }
      continue
    }

    bangumiAgg.set(key.bangumiId, {
      bangumiId: key.bangumiId,
      title,
      coverUrl: card?.cover || null,
      color,
      count: 1,
      nearestDistanceMeters: distance,
    })
  }

  points.sort((a, b) => {
    if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters
    return a.pointId.localeCompare(b.pointId)
  })

  const bangumis = Array.from(bangumiAgg.values()).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count
    if (a.nearestDistanceMeters !== b.nearestDistanceMeters) return a.nearestDistanceMeters - b.nearestDistanceMeters
    return a.bangumiId - b.bangumiId
  })

  return {
    points: points.slice(0, maxPointItems),
    bangumis: bangumis.slice(0, maxBangumiItems),
  }
}
