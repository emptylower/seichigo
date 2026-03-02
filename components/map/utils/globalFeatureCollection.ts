import type { GlobalPointFeatureProperties } from '@/components/map/types'
import type {
  AnitabiPreloadChunkItemDTO,
  AnitabiBangumiCard,
} from '@/lib/anitabi/types'

/** Brand pink fallback when bangumi card has no color */
const DEFAULT_COLOR = '#E91E63'

/**
 * Validate that a geo pair is usable for map display.
 * Rejects null, NaN, Infinity, and [0, 0] (unlikely real location).
 */
function isValidGeo(geo: [number, number] | null): geo is [number, number] {
  if (!Array.isArray(geo)) return false
  const [lng, lat] = geo
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false
  if (lng === 0 && lat === 0) return false
  return true
}

/**
 * Build a GeoJSON FeatureCollection from all warmup preload data.
 *
 * Iterates every bangumi's points in `warmupData`, creates GeoJSON Point
 * features with GlobalPointFeatureProperties, using card color (with fallback).
 * Points with invalid coordinates are skipped.
 *
 * `geo` is already in `[lng, lat]` GeoJSON order — used directly as coordinates.
 */
export function buildGlobalFeatureCollection(
  warmupData: Map<number, AnitabiPreloadChunkItemDTO>,
  cardIndex: Map<number, AnitabiBangumiCard>
): GeoJSON.FeatureCollection<GeoJSON.Point, GlobalPointFeatureProperties> {
  const features: Array<
    GeoJSON.Feature<GeoJSON.Point, GlobalPointFeatureProperties>
  > = []

  for (const [, item] of warmupData) {
    const card = cardIndex.get(item.bangumiId)
    const color = card?.color || DEFAULT_COLOR

    for (const point of item.points) {
      if (!isValidGeo(point.geo)) continue

      features.push({
        type: 'Feature',
        properties: {
          pointId: point.id,
          bangumiId: item.bangumiId,
          color,
          imageUrl: point.image,
          userState: 'none',
          selected: 0,
        },
        geometry: {
          type: 'Point',
          coordinates: point.geo,
        },
      })
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}
