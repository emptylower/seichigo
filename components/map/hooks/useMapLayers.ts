import { useCallback, useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import type { MapMode } from '../types'

// ---------------------------------------------------------------------------
// Constants – Simple Mode layer/source IDs
// ---------------------------------------------------------------------------

export const SIMPLE_POINT_SOURCE_ID = 'anitabi-bangumi-point-source'
export const SIMPLE_POINT_LAYER_ID = 'anitabi-bangumi-point-layer'
export const SIMPLE_POINT_SELECTED_HALO_LAYER_ID = 'anitabi-bangumi-point-selected-halo-layer'
export const SIMPLE_POINT_SELECTED_LAYER_ID = 'anitabi-bangumi-point-selected-layer'

// ---------------------------------------------------------------------------
// Pure functions – Simple Mode layer management
// ---------------------------------------------------------------------------

/**
 * Remove all Simple Mode point layers and source from the map.
 * Safe to call when layers/source don't exist.
 */
export function removeSimpleModeLayers(map: maplibregl.Map): void {
  if (map.getLayer(SIMPLE_POINT_SELECTED_LAYER_ID)) map.removeLayer(SIMPLE_POINT_SELECTED_LAYER_ID)
  if (map.getLayer(SIMPLE_POINT_SELECTED_HALO_LAYER_ID)) map.removeLayer(SIMPLE_POINT_SELECTED_HALO_LAYER_ID)
  if (map.getLayer(SIMPLE_POINT_LAYER_ID)) map.removeLayer(SIMPLE_POINT_LAYER_ID)
  if (map.getSource(SIMPLE_POINT_SOURCE_ID)) map.removeSource(SIMPLE_POINT_SOURCE_ID)
}

/**
 * Ensure Simple Mode point source and all 3 layers exist on the map.
 * If they already exist, returns true immediately (idempotent).
 * On error, cleans up partial state and returns false.
 */
export function ensureSimpleModeLayers(map: maplibregl.Map, geoJsonData: GeoJSON.FeatureCollection): boolean {
  const existingSource = map.getSource(SIMPLE_POINT_SOURCE_ID)
  const hasPointLayer = Boolean(map.getLayer(SIMPLE_POINT_LAYER_ID))
  const hasSelectedHaloLayer = Boolean(map.getLayer(SIMPLE_POINT_SELECTED_HALO_LAYER_ID))
  const hasSelectedLayer = Boolean(map.getLayer(SIMPLE_POINT_SELECTED_LAYER_ID))
  const hasAllPointLayers = hasPointLayer && hasSelectedHaloLayer && hasSelectedLayer
  if (existingSource && hasAllPointLayers) return true

  try {
    removeSimpleModeLayers(map)
    map.addSource(SIMPLE_POINT_SOURCE_ID, {
      type: 'geojson',
      data: geoJsonData,
    })

    map.addLayer({
      id: SIMPLE_POINT_LAYER_ID,
      type: 'circle',
      source: SIMPLE_POINT_SOURCE_ID,
      paint: {
        'circle-color': [
          'match',
          ['get', 'userState'],
          'checked_in',
          '#22c55e',
          'planned',
          '#f97316',
          'want_to_go',
          '#3b82f6',
          ['coalesce', ['get', 'color'], '#6d28d9'],
        ],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3.4, 8, 5.4, 12, 6.8],
        'circle-stroke-color': ['match', ['get', 'userState'], 'checked_in', '#15803d', '#ffffff'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 1.2, 12, 2.2],
        'circle-opacity': 0.95,
      },
    })

    map.addLayer({
      id: SIMPLE_POINT_SELECTED_HALO_LAYER_ID,
      type: 'circle',
      source: SIMPLE_POINT_SOURCE_ID,
      filter: ['==', ['get', 'selected'], 1],
      paint: {
        'circle-color': [
          'match',
          ['get', 'userState'],
          'checked_in',
          '#22c55e',
          'planned',
          '#f97316',
          'want_to_go',
          '#3b82f6',
          ['coalesce', ['get', 'color'], '#6d28d9'],
        ],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 7, 8, 12, 12, 16],
        'circle-opacity': 0.2,
      },
    })

    map.addLayer({
      id: SIMPLE_POINT_SELECTED_LAYER_ID,
      type: 'circle',
      source: SIMPLE_POINT_SOURCE_ID,
      filter: ['==', ['get', 'selected'], 1],
      paint: {
        'circle-color': [
          'match',
          ['get', 'userState'],
          'checked_in',
          '#22c55e',
          'planned',
          '#f97316',
          'want_to_go',
          '#3b82f6',
          ['coalesce', ['get', 'color'], '#6d28d9'],
        ],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 8, 7.2, 12, 8.8],
        'circle-stroke-color': ['match', ['get', 'userState'], 'checked_in', '#15803d', '#ffffff'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 1.8, 12, 2.6],
        'circle-opacity': 0.98,
      },
    })
    return true
  } catch {
    removeSimpleModeLayers(map)
    return false
  }
}

/**
 * Get IDs of existing Simple Mode point layers (for queryRenderedFeatures).
 * Returns selected layer first for hit-priority.
 */
export function getSimplePointLayerIds(map: maplibregl.Map): string[] {
  return [SIMPLE_POINT_SELECTED_LAYER_ID, SIMPLE_POINT_LAYER_ID].filter((id) =>
    Boolean(map.getLayer(id))
  )
}

/**
 * Read pointId from rendered features at a screen point.
 * Returns null if no point feature is hit.
 */
export function readPointIdFromRendered(
  map: maplibregl.Map,
  point: maplibregl.PointLike
): string | null {
  const layers = getSimplePointLayerIds(map)
  if (!layers.length) return null
  const hit = map.queryRenderedFeatures(point, { layers })[0]
  const pointId = hit?.properties?.pointId
  return typeof pointId === 'string' ? pointId : null
}

/**
 * Flush Simple Mode layers: sync GeoJSON data to the map.
 * If hasDetail is false, removes layers. Otherwise ensures layers and updates data.
 */
export function flushSimpleModeLayers(
  map: maplibregl.Map,
  geoJsonData: GeoJSON.FeatureCollection,
  hasDetail: boolean
): boolean {
  if (!hasDetail) {
    const hasSource = Boolean(map.getSource(SIMPLE_POINT_SOURCE_ID))
    const hasAnyLayer = Boolean(
      map.getLayer(SIMPLE_POINT_LAYER_ID) ||
        map.getLayer(SIMPLE_POINT_SELECTED_HALO_LAYER_ID) ||
        map.getLayer(SIMPLE_POINT_SELECTED_LAYER_ID)
    )
    if (hasSource || hasAnyLayer) removeSimpleModeLayers(map)
    map.triggerRepaint()
    return true
  }

  if (!ensureSimpleModeLayers(map, geoJsonData)) return false
  const source = map.getSource(SIMPLE_POINT_SOURCE_ID)
  if (!source || !('setData' in source)) return false
  ;(source as { setData(d: GeoJSON.GeoJSON): void }).setData(geoJsonData)
  map.triggerRepaint()
  return true
}

// ---------------------------------------------------------------------------
// Hook – useMapLayers
// ---------------------------------------------------------------------------

export type UseMapLayersOptions = {
  /** Ref to the pending GeoJSON FeatureCollection for Simple Mode points */
  pendingGeoJsonRef: React.RefObject<GeoJSON.FeatureCollection>
  /** Returns true when a bangumi detail is loaded (points should be shown) */
  hasDetail: () => boolean
  /** Optional callback when layers are first flushed with visible points */
  onFirstPointVisible?: () => void
}

export type UseMapLayersReturn = {
  /** Ensure Simple Mode point layers exist on the map */
  ensureSimpleLayers: (map: maplibregl.Map) => boolean
  /** Ensure Complete Mode layers exist (stub – returns false until implemented) */
  ensureCompleteLayers: () => boolean
  /** Flush current point data to map layers */
  flushLayers: () => boolean
  /** Schedule a deferred flush (requestAnimationFrame + fallback timer) */
  flushLayersSoon: () => void
  /** Schedule a fallback flush after 650ms delay */
  scheduleFlushFallback: () => void
  /** Remove all Simple Mode layers from the map */
  cleanup: (map: maplibregl.Map) => void
  /** Ref to the current sync function (for external event handlers) */
  syncLayerRef: React.RefObject<() => boolean>
}

export function useMapLayers(
  mapRef: React.RefObject<maplibregl.Map | null>,
  _mode: MapMode,
  options: UseMapLayersOptions
): UseMapLayersReturn {
  const { pendingGeoJsonRef, hasDetail, onFirstPointVisible } = options
  const firstPointVisibleFiredRef = useRef(false)
  const fallbackTimerRef = useRef<number | null>(null)

  const ensureSimpleLayers = useCallback(
    (map: maplibregl.Map): boolean => {
      return ensureSimpleModeLayers(map, pendingGeoJsonRef.current)
    },
    [pendingGeoJsonRef]
  )

  const ensureCompleteLayers = useCallback((): boolean => {
    // Placeholder – Complete Mode layer setup will be wired in Task 11
    return false
  }, [])

  const flushLayers = useCallback((): boolean => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return false

    const detail = hasDetail()
    const ok = flushSimpleModeLayers(map, pendingGeoJsonRef.current, detail)

    if (
      ok &&
      detail &&
      !firstPointVisibleFiredRef.current &&
      pendingGeoJsonRef.current.features.length > 0 &&
      onFirstPointVisible
    ) {
      firstPointVisibleFiredRef.current = true
      onFirstPointVisible()
    }

    return ok
  }, [mapRef, hasDetail, pendingGeoJsonRef, onFirstPointVisible])

  // Stable ref so external event handlers always call the latest flush
  const syncLayerRef = useRef<() => boolean>(flushLayers)
  useEffect(() => {
    syncLayerRef.current = flushLayers
  }, [flushLayers])

  const scheduleFlushFallback = useCallback(() => {
    if (typeof window === 'undefined') return
    if (fallbackTimerRef.current != null) return
    fallbackTimerRef.current = window.setTimeout(() => {
      fallbackTimerRef.current = null
      syncLayerRef.current()
    }, 650)
  }, [])

  const flushLayersSoon = useCallback(() => {
    if (typeof window === 'undefined') {
      const ok = syncLayerRef.current()
      if (!ok) scheduleFlushFallback()
      return
    }
    window.requestAnimationFrame(() => {
      const ok = syncLayerRef.current()
      if (!ok) scheduleFlushFallback()
    })
  }, [scheduleFlushFallback])

  const cleanup = useCallback((map: maplibregl.Map): void => {
    removeSimpleModeLayers(map)
  }, [])

  // Cleanup fallback timer on unmount
  useEffect(
    () => () => {
      if (fallbackTimerRef.current != null) {
        window.clearTimeout(fallbackTimerRef.current)
        fallbackTimerRef.current = null
      }
    },
    []
  )

  return {
    ensureSimpleLayers,
    ensureCompleteLayers,
    flushLayers,
    flushLayersSoon,
    scheduleFlushFallback,
    cleanup,
    syncLayerRef,
  }
}
