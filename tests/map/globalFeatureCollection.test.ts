import { describe, it, expect } from 'vitest'
import { buildGlobalFeatureCollection } from '@/components/map/utils/globalFeatureCollection'
import type { AnitabiPreloadChunkItemDTO, AnitabiBangumiCard } from '@/lib/anitabi/types'
import type { GlobalPointFeatureProperties } from '@/components/map/types'

// ── Helpers ───────────────────────────────────────────────────────────────

function makePoints(
  count: number,
  prefix = 'pt'
): AnitabiPreloadChunkItemDTO['points'] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    name: `Point ${i + 1}`,
    nameZh: null,
    geo: [139.7 + i * 0.01, 35.6 + i * 0.01] as [number, number],
    ep: null,
    s: null,
    image: `https://anitabi.cn/img/${prefix}-${i + 1}.jpg`,
    density: null,
    note: null,
  }))
}

function makeChunkItem(
  bangumiId: number,
  pointCount: number
): AnitabiPreloadChunkItemDTO {
  return {
    bangumiId,
    modifiedMs: Date.now(),
    points: makePoints(pointCount, `b${bangumiId}`),
    theme: null,
  }
}

function makeCard(
  id: number,
  color: string | null = '#FF0000'
): AnitabiBangumiCard {
  return {
    id,
    title: `Bangumi ${id}`,
    titleZh: null,
    cat: null,
    city: null,
    cover: null,
    color,
    pointsLength: 5,
    imagesLength: 3,
    sourceModifiedMs: null,
    mapEnabled: true,
    geo: null,
    zoom: null,
    nearestDistanceMeters: null,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('buildGlobalFeatureCollection', () => {
  it('should produce 15 features from 3 bangumi × 5 points', () => {
    const warmupData = new Map<number, AnitabiPreloadChunkItemDTO>()
    const cardIndex = new Map<number, AnitabiBangumiCard>()

    for (let i = 1; i <= 3; i++) {
      warmupData.set(i, makeChunkItem(i, 5))
      cardIndex.set(i, makeCard(i, `#${String(i).repeat(6)}`))
    }

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(15)

    // Verify each feature structure
    for (const feature of fc.features) {
      expect(feature.type).toBe('Feature')
      expect(feature.geometry.type).toBe('Point')
      expect(feature.geometry.coordinates).toHaveLength(2)
      expect(feature.properties.pointId).toBeTruthy()
      expect(feature.properties.bangumiId).toBeGreaterThan(0)
      expect(feature.properties.selected).toBe(0)
      expect(feature.properties.userState).toBe('none')
    }
  })

  it('should use bangumi color from card', () => {
    const warmupData = new Map<number, AnitabiPreloadChunkItemDTO>()
    const cardIndex = new Map<number, AnitabiBangumiCard>()

    warmupData.set(10, makeChunkItem(10, 1))
    cardIndex.set(10, makeCard(10, '#ABCDEF'))

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.features[0].properties.color).toBe('#ABCDEF')
  })

  it('should fallback to #E91E63 when card color is null', () => {
    const warmupData = new Map<number, AnitabiPreloadChunkItemDTO>()
    const cardIndex = new Map<number, AnitabiBangumiCard>()

    warmupData.set(20, makeChunkItem(20, 1))
    cardIndex.set(20, makeCard(20, null))

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.features[0].properties.color).toBe('#E91E63')
  })

  it('should fallback to #E91E63 when card is missing from cardIndex', () => {
    const warmupData = new Map<number, AnitabiPreloadChunkItemDTO>()
    const cardIndex = new Map<number, AnitabiBangumiCard>()

    warmupData.set(30, makeChunkItem(30, 1))
    // No card added for bangumiId 30

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.features[0].properties.color).toBe('#E91E63')
    expect(fc.features[0].properties.bangumiId).toBe(30)
  })

  it('should skip points with null geo', () => {
    const item: AnitabiPreloadChunkItemDTO = {
      bangumiId: 40,
      modifiedMs: Date.now(),
      points: [
        { id: 'p1', name: 'valid', nameZh: null, geo: [139.7, 35.6], ep: null, s: null, image: null, density: null, note: null },
        { id: 'p2', name: 'null-geo', nameZh: null, geo: null, ep: null, s: null, image: null, density: null, note: null },
      ],
      theme: null,
    }

    const warmupData = new Map([[40, item]])
    const cardIndex = new Map([[40, makeCard(40)]])

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties.pointId).toBe('p1')
  })

  it('should skip points with [0, 0] coordinates', () => {
    const item: AnitabiPreloadChunkItemDTO = {
      bangumiId: 50,
      modifiedMs: Date.now(),
      points: [
        { id: 'p1', name: 'origin', nameZh: null, geo: [0, 0], ep: null, s: null, image: null, density: null, note: null },
        { id: 'p2', name: 'valid', nameZh: null, geo: [139.7, 35.6], ep: null, s: null, image: null, density: null, note: null },
      ],
      theme: null,
    }

    const warmupData = new Map([[50, item]])
    const cardIndex = new Map([[50, makeCard(50)]])

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties.pointId).toBe('p2')
  })

  it('should skip points with NaN coordinates', () => {
    const item: AnitabiPreloadChunkItemDTO = {
      bangumiId: 60,
      modifiedMs: Date.now(),
      points: [
        { id: 'p1', name: 'nan-lng', nameZh: null, geo: [NaN, 35.6], ep: null, s: null, image: null, density: null, note: null },
        { id: 'p2', name: 'nan-lat', nameZh: null, geo: [139.7, NaN], ep: null, s: null, image: null, density: null, note: null },
        { id: 'p3', name: 'valid', nameZh: null, geo: [139.7, 35.6], ep: null, s: null, image: null, density: null, note: null },
      ],
      theme: null,
    }

    const warmupData = new Map([[60, item]])
    const cardIndex = new Map([[60, makeCard(60)]])

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties.pointId).toBe('p3')
  })

  it('should return empty FeatureCollection for empty warmupData', () => {
    const warmupData = new Map<number, AnitabiPreloadChunkItemDTO>()
    const cardIndex = new Map<number, AnitabiBangumiCard>()

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(0)
  })

  it('should return empty FeatureCollection when bangumi has zero points', () => {
    const warmupData = new Map<number, AnitabiPreloadChunkItemDTO>()
    const cardIndex = new Map<number, AnitabiBangumiCard>()

    warmupData.set(70, { bangumiId: 70, modifiedMs: Date.now(), points: [], theme: null })
    cardIndex.set(70, makeCard(70))

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(0)
  })

  it('should set imageUrl from point.image', () => {
    const warmupData = new Map<number, AnitabiPreloadChunkItemDTO>()
    const cardIndex = new Map<number, AnitabiBangumiCard>()

    warmupData.set(80, makeChunkItem(80, 1))
    cardIndex.set(80, makeCard(80))

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.features[0].properties.imageUrl).toBe('https://anitabi.cn/img/b80-1.jpg')
  })

  it('should set imageUrl to null when point.image is null', () => {
    const item: AnitabiPreloadChunkItemDTO = {
      bangumiId: 90,
      modifiedMs: Date.now(),
      points: [
        { id: 'p1', name: 'no-image', nameZh: null, geo: [139.7, 35.6], ep: null, s: null, image: null, density: null, note: null },
      ],
      theme: null,
    }

    const warmupData = new Map([[90, item]])
    const cardIndex = new Map([[90, makeCard(90)]])

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.features[0].properties.imageUrl).toBeNull()
  })

  it('should swap geo from [lat, lng] to [lng, lat] for GeoJSON coordinates', () => {
    const item: AnitabiPreloadChunkItemDTO = {
      bangumiId: 100,
      modifiedMs: Date.now(),
      points: [
        { id: 'p1', name: 'tokyo', nameZh: null, geo: [35.6895, 139.6917], ep: null, s: null, image: null, density: null, note: null },
      ],
      theme: null,
    }

    const warmupData = new Map([[100, item]])
    const cardIndex = new Map([[100, makeCard(100)]])

    const fc = buildGlobalFeatureCollection(warmupData, cardIndex)

    expect(fc.features[0].geometry.coordinates).toEqual([139.6917, 35.6895])
  })
})
