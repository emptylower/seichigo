import { describe, expect, it } from 'vitest'
import type { AnitabiBangumiCard, AnitabiPreloadChunkItemDTO } from '@/lib/anitabi/types'
import { computeWindowExcerpt } from '@/features/map/anitabi/windowExcerpt'

function makeCard(id: number, title: string, color: string): AnitabiBangumiCard {
  return {
    id,
    title,
    titleZh: null,
    cat: 'TV',
    city: null,
    cover: `https://example.com/${id}.jpg`,
    color,
    pointsLength: 0,
    imagesLength: 0,
    sourceModifiedMs: null,
    mapEnabled: true,
    geo: null,
    zoom: null,
    nearestDistanceMeters: null,
  }
}

function makeChunk(bangumiId: number, points: Array<{ id: string; lng: number; lat: number; image?: string | null }>): AnitabiPreloadChunkItemDTO {
  return {
    bangumiId,
    modifiedMs: 0,
    theme: null,
    points: points.map((point, index) => ({
      id: point.id,
      name: `Point ${index}`,
      nameZh: null,
      geo: [point.lat, point.lng],
      ep: null,
      s: null,
      image: point.image ?? null,
      density: null,
      note: null,
    })),
  }
}

describe('computeWindowExcerpt', () => {
  it('keeps nearest visible points with images and groups by bangumi', () => {
    const warmPointIndexByBangumiId = new Map<number, AnitabiPreloadChunkItemDTO>([
      [1, makeChunk(1, [
        { id: '1:a', lng: 139.0, lat: 35.0, image: 'https://example.com/a.jpg' },
        { id: '1:b', lng: 139.001, lat: 35.0, image: 'https://example.com/b.jpg' },
      ])],
      [2, makeChunk(2, [
        { id: '2:a', lng: 139.002, lat: 35.0, image: 'https://example.com/c.jpg' },
        { id: '2:b', lng: 139.003, lat: 35.0, image: null },
      ])],
    ])

    const allCards = new Map<number, AnitabiBangumiCard>([
      [1, makeCard(1, 'Work A', '#ff0000')],
      [2, makeCard(2, 'Work B', '#00ff00')],
    ])

    const result = computeWindowExcerpt({
      center: [139.0, 35.0],
      visiblePointKeys: [
        { bangumiId: 1, pointId: '1:b' },
        { bangumiId: 2, pointId: '2:a' },
        { bangumiId: 1, pointId: '1:a' },
        { bangumiId: 2, pointId: '2:b' },
      ],
      warmPointIndexByBangumiId,
      allCards,
      maxPointItems: 9,
      maxBangumiItems: 7,
    })

    expect(result.points.map((item) => item.pointId)).toEqual(['1:a', '1:b', '2:a'])
    expect(result.bangumis.map((item) => ({ bangumiId: item.bangumiId, count: item.count }))).toEqual([
      { bangumiId: 1, count: 2 },
      { bangumiId: 2, count: 1 },
    ])
  })

  it('applies max item caps and ignores duplicates', () => {
    const chunk = makeChunk(1, Array.from({ length: 12 }, (_, index) => ({
      id: `1:${index}`,
      lng: 139 + index * 0.0001,
      lat: 35,
      image: `https://example.com/${index}.jpg`,
    })))

    const result = computeWindowExcerpt({
      center: [139, 35],
      visiblePointKeys: Array.from({ length: 12 }, (_, index) => ({ bangumiId: 1, pointId: `1:${index}` })).concat([
        { bangumiId: 1, pointId: '1:0' },
      ]),
      warmPointIndexByBangumiId: new Map([[1, chunk]]),
      allCards: new Map([[1, makeCard(1, 'Work A', '#ff0000')]]),
      maxPointItems: 9,
      maxBangumiItems: 7,
    })

    expect(result.points).toHaveLength(9)
    expect(result.bangumis).toHaveLength(1)
    expect(result.bangumis[0]?.count).toBe(12)
  })
})
