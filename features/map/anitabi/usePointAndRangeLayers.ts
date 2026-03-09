import { useCallback, useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import {
  POINT_LAYER_ID,
  POINT_SELECTED_HALO_LAYER_ID,
  POINT_SELECTED_LAYER_ID,
  POINT_SOURCE_ID,
  RANGE_FILL_LAYER_ID,
  RANGE_LINE_LAYER_ID,
  RANGE_SOURCE_ID,
} from './shared'
import {
  buildCoverageArea,
  buildDistanceClusters,
  hexToRgba,
  removePointLayer,
  removeRangeLayer,
} from './geo'
import { buildPointFeatureCollection, collectPointCoords, createEmptyPointFeatureCollection } from './media'

export function usePointAndRangeLayers(ctx: any) {
  const {
    mapRef,
    detail,
    detailRef,
    selectedPointId,
    meState,
    viewFilter,
    stateFilter,
    pendingPointGeoJsonRef,
    syncPointLayerRef,
    pointLayerFallbackTimerRef,
    syncRangeOverlayRef,
    rangeOverlayFallbackTimerRef,
    rangeOverlayRef,
    firstOpenPointVisibleRecordedRef,
    firstOpenPointStartedAtRef,
    warmupMetricRef,
  } = ctx

  const ensurePointSourceAndLayers = useCallback((map: maplibregl.Map): boolean => {
    const existingSource = map.getSource(POINT_SOURCE_ID)
    const hasPointLayer = Boolean(map.getLayer(POINT_LAYER_ID))
    const hasSelectedHaloLayer = Boolean(map.getLayer(POINT_SELECTED_HALO_LAYER_ID))
    const hasSelectedLayer = Boolean(map.getLayer(POINT_SELECTED_LAYER_ID))
    const hasAllPointLayers = hasPointLayer && hasSelectedHaloLayer && hasSelectedLayer
    if (existingSource && hasAllPointLayers) return true

    try {
      removePointLayer(map)
      map.addSource(POINT_SOURCE_ID, {
        type: 'geojson',
        data: pendingPointGeoJsonRef.current,
      })

      map.addLayer({
        id: POINT_LAYER_ID,
        type: 'circle',
        source: POINT_SOURCE_ID,
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
        id: POINT_SELECTED_HALO_LAYER_ID,
        type: 'circle',
        source: POINT_SOURCE_ID,
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
        id: POINT_SELECTED_LAYER_ID,
        type: 'circle',
        source: POINT_SOURCE_ID,
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
      removePointLayer(map)
      return false
    }
  }, [pendingPointGeoJsonRef])

  const flushPointLayer = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return false

    const hasDetail = Boolean(detailRef.current)
    if (!hasDetail) {
      const hasSource = Boolean(map.getSource(POINT_SOURCE_ID))
      const hasAnyLayer = Boolean(map.getLayer(POINT_LAYER_ID) || map.getLayer(POINT_SELECTED_HALO_LAYER_ID) || map.getLayer(POINT_SELECTED_LAYER_ID))
      if (hasSource || hasAnyLayer) removePointLayer(map)
      map.triggerRepaint()
      return true
    }

    if (!ensurePointSourceAndLayers(map)) return false
    const source = map.getSource(POINT_SOURCE_ID)
    if (!source || !('setData' in source)) return false
    ;(source as { setData(d: GeoJSON.GeoJSON): void }).setData(pendingPointGeoJsonRef.current)
    map.triggerRepaint()

    if (!firstOpenPointVisibleRecordedRef.current && firstOpenPointStartedAtRef.current != null && pendingPointGeoJsonRef.current.features.length > 0) {
      firstOpenPointVisibleRecordedRef.current = true
      warmupMetricRef.current.first_open_point_visible_ms = Math.round(performance.now() - firstOpenPointStartedAtRef.current)
    }
    return true
  }, [
    detailRef,
    ensurePointSourceAndLayers,
    firstOpenPointStartedAtRef,
    firstOpenPointVisibleRecordedRef,
    mapRef,
    pendingPointGeoJsonRef,
    warmupMetricRef,
  ])

  useEffect(() => {
    syncPointLayerRef.current = flushPointLayer
  }, [flushPointLayer, syncPointLayerRef])

  const schedulePointLayerFallbackFlush = useCallback(() => {
    if (typeof window === 'undefined') return
    if (pointLayerFallbackTimerRef.current != null) return
    pointLayerFallbackTimerRef.current = window.setTimeout(() => {
      pointLayerFallbackTimerRef.current = null
      syncPointLayerRef.current()
    }, 650)
  }, [pointLayerFallbackTimerRef, syncPointLayerRef])

  const scheduleRangeOverlayFallbackFlush = useCallback(() => {
    if (typeof window === 'undefined') return
    if (rangeOverlayFallbackTimerRef.current != null) return
    rangeOverlayFallbackTimerRef.current = window.setTimeout(() => {
      rangeOverlayFallbackTimerRef.current = null
      syncRangeOverlayRef.current()
    }, 650)
  }, [rangeOverlayFallbackTimerRef, syncRangeOverlayRef])

  const refreshPendingPointGeoJson = useCallback(() => {
    pendingPointGeoJsonRef.current = detail
      ? buildPointFeatureCollection(detail, selectedPointId, meState, viewFilter, stateFilter)
      : createEmptyPointFeatureCollection()
    const ok = syncPointLayerRef.current()
    if (!ok) schedulePointLayerFallbackFlush()
  }, [
    detail,
    meState,
    pendingPointGeoJsonRef,
    schedulePointLayerFallbackFlush,
    selectedPointId,
    stateFilter,
    syncPointLayerRef,
    viewFilter,
  ])

  useEffect(() => {
    refreshPendingPointGeoJson()
  }, [refreshPendingPointGeoJson])

  const flushPointLayerSoon = useCallback(() => {
    if (typeof window === 'undefined') {
      const ok = syncPointLayerRef.current()
      if (!ok) schedulePointLayerFallbackFlush()
      return
    }
    window.requestAnimationFrame(() => {
      const ok = syncPointLayerRef.current()
      if (!ok) schedulePointLayerFallbackFlush()
    })
  }, [schedulePointLayerFallbackFlush, syncPointLayerRef])

  const syncRangeOverlay = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return false

    const existingRangeSource = map.getSource(RANGE_SOURCE_ID)
    const hasFillLayer = Boolean(map.getLayer(RANGE_FILL_LAYER_ID))
    const hasLineLayer = Boolean(map.getLayer(RANGE_LINE_LAYER_ID))
    const hasAnyRangeLayer = hasFillLayer || hasLineLayer
    const hasAllRangeLayers = hasFillLayer && hasLineLayer

    const overlay = rangeOverlayRef.current
    if (!overlay) {
      if (existingRangeSource || hasAnyRangeLayer) removeRangeLayer(map)
      map.triggerRepaint()
      return true
    }

    try {
      if (existingRangeSource && hasAllRangeLayers && 'setData' in existingRangeSource) {
        ;(existingRangeSource as { setData(d: GeoJSON.GeoJSON): void }).setData(overlay.data)
        map.setPaintProperty(RANGE_FILL_LAYER_ID, 'fill-color', hexToRgba(overlay.color, 0.16))
        map.setPaintProperty(RANGE_LINE_LAYER_ID, 'line-color', hexToRgba(overlay.color, 0.88))
        map.triggerRepaint()
        return true
      }

      removeRangeLayer(map)
      map.addSource(RANGE_SOURCE_ID, {
        type: 'geojson',
        data: overlay.data,
      })

      const beforePointLayer = map.getLayer(POINT_LAYER_ID) ? POINT_LAYER_ID : undefined
      map.addLayer({
        id: RANGE_FILL_LAYER_ID,
        type: 'fill',
        source: RANGE_SOURCE_ID,
        paint: {
          'fill-color': hexToRgba(overlay.color, 0.16),
          'fill-opacity': 1,
        },
      }, beforePointLayer)
      map.addLayer({
        id: RANGE_LINE_LAYER_ID,
        type: 'line',
        source: RANGE_SOURCE_ID,
        paint: {
          'line-color': hexToRgba(overlay.color, 0.88),
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.2, 12, 3.2],
        },
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
      }, beforePointLayer)

      map.triggerRepaint()
      return true
    } catch {
      removeRangeLayer(map)
      return false
    }
  }, [mapRef, rangeOverlayRef])

  useEffect(() => {
    syncRangeOverlayRef.current = syncRangeOverlay
  }, [syncRangeOverlay, syncRangeOverlayRef])

  useEffect(() => () => {
    if (pointLayerFallbackTimerRef.current != null) {
      window.clearTimeout(pointLayerFallbackTimerRef.current)
      pointLayerFallbackTimerRef.current = null
    }
    if (rangeOverlayFallbackTimerRef.current != null) {
      window.clearTimeout(rangeOverlayFallbackTimerRef.current)
      rangeOverlayFallbackTimerRef.current = null
    }
  }, [pointLayerFallbackTimerRef, rangeOverlayFallbackTimerRef])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const ok = syncPointLayerRef.current()
    if (!ok) {
      flushPointLayerSoon()
    }
  }, [detail, flushPointLayerSoon, mapRef, meState, selectedPointId, stateFilter, syncPointLayerRef, viewFilter])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!detail) {
      rangeOverlayRef.current = null
      if (!syncRangeOverlay()) {
        scheduleRangeOverlayFallbackFlush()
      }
      return
    }

    const points = collectPointCoords(detail.points)
    const clusters = buildDistanceClusters(points)
    const features: GeoJSON.Feature<GeoJSON.Polygon>[] = []

    for (const cluster of clusters) {
      const area = buildCoverageArea(cluster)
      if (!area) continue
      for (const feature of area.features) {
        features.push(feature)
      }
    }

    rangeOverlayRef.current = features.length
      ? {
          data: {
            type: 'FeatureCollection',
            features,
          },
          color: detail.card.color || '#ec4899',
        }
      : null

    if (!syncRangeOverlay()) {
      scheduleRangeOverlayFallbackFlush()
    }
  }, [detail, mapRef, rangeOverlayRef, scheduleRangeOverlayFallbackFlush, syncRangeOverlay])

  return {
    flushPointLayerSoon,
    schedulePointLayerFallbackFlush,
    scheduleRangeOverlayFallbackFlush,
    syncRangeOverlay,
  }
}
