import { useEffect } from 'react'
import maplibregl, { type MapStyleImageMissingEvent } from 'maplibre-gl'
import {
  COMPLETE_BANGUMI_COVERS_LAYER_ID,
  COMPLETE_DOTS_LAYER_ID,
  COMPLETE_ICONS_LAYER_ID,
  COMPLETE_POINT_IMAGES_LAYER_ID,
  COMPLETE_THEME_FALLBACK_LAYER_ID,
  removeCompleteModeLayers,
  removeLabelLayer,
} from '@/components/map/CompleteModeLayers'
import { buildFallbackRasterStyle, getMapStyleCandidates, matchPointId, resolvePanoramaEmbed } from './media'
import {
  MAP_KEEP_PENDING_TILE_REQUESTS_DURING_ZOOM,
  MAP_STYLE_FAILOVER_ERROR_BURST_THRESHOLD,
  MAP_STYLE_FAILOVER_ERROR_BURST_WINDOW_MS,
  MAP_STYLE_FAILOVER_TIMEOUT_MS,
  MAP_STYLE_MISSING_IMAGE_FALLBACK_MAX,
  MAP_TILE_CACHE_ZOOM_LEVELS,
  MAP_TILE_FADE_DURATION_MS,
  PANORAMA_TRIGGER_ZOOM,
  POINT_LAYER_ID,
  POINT_SELECTED_LAYER_ID,
  POINT_SELECTED_HALO_LAYER_ID,
  shouldSkipMissingStyleImageFallback,
} from './shared'
import { isValidGeoPair } from './media'
import { removePointLayer, removeRangeLayer } from './geo'

export function useMapStyleFailover(ctx: any) {
  const {
    mapRootRef,
    mapRef,
    parsed,
    syncUrlRef,
    setMapZoom,
    mapModeRef,
    syncCompleteModeRef,
    syncPointLayerRef,
    syncRangeOverlayRef,
    schedulePointLayerFallbackFlush,
    scheduleRangeOverlayFallbackFlush,
    openBangumiRef,
    clearActiveBangumiSelectionRef,
    selectedPointIdRef,
    detailRef,
    setDetailCardMode,
    setSelectedPointId,
    setMobilePointPopupOpen,
    isDesktopRef,
    setMapViewMode,
    focusGeo,
    userMarkerRef,
    focusTimerRef,
    mapInitWaitersRef,
    setMapReady,
    applyMapStyleRef,
    currentStyleModeRef,
    styleProviderIndexRef,
    styleFailoverTimerRef,
    styleAttemptRef,
    styleErrorBurstRef,
    styleMode,
    coverAvatarLoaderRef,
    loadedCoverIdsRef,
    completeCoverFeatureCollectionRef,
    completeCoverCandidatesRef,
  } = ctx

  useEffect(() => {
    const mapRoot = mapRootRef.current
    if (!mapRoot || mapRef.current) return

    const streetCandidates = getMapStyleCandidates('street')
    const initialStreetIndex = Math.max(0, Math.min(styleProviderIndexRef.current.street || 0, streetCandidates.length - 1))
    const initialStreetCandidate = streetCandidates[initialStreetIndex] || {
      provider: 'raster' as const,
      label: 'raster',
      style: buildFallbackRasterStyle('street'),
    }
    styleProviderIndexRef.current.street = initialStreetIndex
    currentStyleModeRef.current = 'street'

    const map = new maplibregl.Map({
      container: mapRoot,
      style: initialStreetCandidate.style,
      center: [parsed.lng, parsed.lat],
      zoom: parsed.z,
      pitchWithRotate: false,
      dragRotate: false,
      renderWorldCopies: true,
      dragPan: true,
      scrollZoom: true,
      maxTileCacheZoomLevels: MAP_TILE_CACHE_ZOOM_LEVELS,
      cancelPendingTileRequestsWhileZooming: !MAP_KEEP_PENDING_TILE_REQUESTS_DURING_ZOOM,
      fadeDuration: MAP_TILE_FADE_DURATION_MS,
    })

    const clearStyleFailoverTimer = () => {
      if (styleFailoverTimerRef.current != null) {
        window.clearTimeout(styleFailoverTimerRef.current)
        styleFailoverTimerRef.current = null
      }
    }

    const armStyleFailoverGuard = (mode: 'street' | 'satellite', providerIndex: number) => {
      clearStyleFailoverTimer()
      styleAttemptRef.current += 1
      const attempt = styleAttemptRef.current
      styleErrorBurstRef.current = { count: 0, startedAt: 0 }
      styleFailoverTimerRef.current = window.setTimeout(() => {
        if (styleAttemptRef.current !== attempt) return
        if (currentStyleModeRef.current !== mode) return
        const candidates = getMapStyleCandidates(mode)
        if (providerIndex >= candidates.length - 1) return
        void switchStyleProvider(mode, providerIndex + 1)
      }, MAP_STYLE_FAILOVER_TIMEOUT_MS)
    }

    function switchStyleProvider(mode: 'street' | 'satellite', providerIndex: number): boolean {
      const candidates = getMapStyleCandidates(mode)
      if (!candidates.length) return false
      const safeIndex = Math.max(0, Math.min(providerIndex, candidates.length - 1))
      const nextCandidate = candidates[safeIndex]
      if (!nextCandidate) return false
      currentStyleModeRef.current = mode
      styleProviderIndexRef.current[mode] = safeIndex
      armStyleFailoverGuard(mode, safeIndex)
      map.setStyle(nextCandidate.style)
      return true
    }

    applyMapStyleRef.current = (mode: 'street' | 'satellite', options?: { resetProvider?: boolean }) => {
      const resetProvider = Boolean(options?.resetProvider)
      const providerIndex = resetProvider ? 0 : (styleProviderIndexRef.current[mode] || 0)
      void switchStyleProvider(mode, providerIndex)
    }
    armStyleFailoverGuard('street', initialStreetIndex)

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    const syncMapViewState = () => {
      syncUrlRef.current()
      setMapZoom(map.getZoom())
      if (mapModeRef.current === 'complete') {
        syncCompleteModeRef.current()
      }
    }
    map.on('moveend', syncMapViewState)
    map.on('zoomend', syncMapViewState)
    const pointLayerIds = () => [POINT_SELECTED_LAYER_ID, POINT_LAYER_ID].filter((id) => Boolean(map.getLayer(id)))
    const completeLayerIds = () => [
      COMPLETE_POINT_IMAGES_LAYER_ID,
      COMPLETE_ICONS_LAYER_ID,
      COMPLETE_THEME_FALLBACK_LAYER_ID,
      COMPLETE_BANGUMI_COVERS_LAYER_ID,
      COMPLETE_DOTS_LAYER_ID,
    ].filter((id) => Boolean(map.getLayer(id)))
    const readPointIdFromRendered = (event: maplibregl.MapMouseEvent): string | null => {
      const layers = pointLayerIds()
      if (!layers.length) return null
      const hit = map.queryRenderedFeatures(event.point, { layers })[0]
      const pointId = hit?.properties?.pointId
      return typeof pointId === 'string' ? pointId : null
    }
    const readCompleteTargetFromRendered = (
      event: maplibregl.MapMouseEvent
    ): { bangumiId: number; pointId: string | null } | null => {
      const layers = completeLayerIds()
      if (!layers.length) return null
      const hit = map.queryRenderedFeatures(event.point, { layers })[0]
      if (!hit) return null
      const bangumiId = hit.properties?.bangumiId
      if (!bangumiId) return null
      const numericBangumiId = typeof bangumiId === 'string' ? Number.parseInt(bangumiId, 10) : Number(bangumiId)
      if (!Number.isFinite(numericBangumiId)) return null
      const pointId = hit.properties?.pointId
      return {
        bangumiId: numericBangumiId,
        pointId: typeof pointId === 'string' ? pointId : null,
      }
    }
    const handlePointClick = (event: maplibregl.MapMouseEvent) => {
      if (mapModeRef.current === 'complete') {
        const completeTarget = readCompleteTargetFromRendered(event)
        if (completeTarget) {
          openBangumiRef.current?.(
            completeTarget.bangumiId,
            completeTarget.pointId,
            { keepMobilePointPopup: Boolean(!isDesktopRef.current && completeTarget.pointId) }
          )?.catch(() => null)
          return
        }
        if (detailRef.current) {
          clearActiveBangumiSelectionRef.current?.()
          return
        }
      }
      const pointId = readPointIdFromRendered(event)
      if (!pointId) return
      const prevPointId = selectedPointIdRef.current
      setDetailCardMode('point')
      setSelectedPointId(pointId)
      if (!isDesktopRef.current) {
        setMobilePointPopupOpen(true)
      }
      const activeDetail = detailRef.current
      const target = activeDetail?.points.find((point: any) => matchPointId(point.id, pointId)) || null
      if (target) {
        const sameAsPrev = Boolean(prevPointId && (matchPointId(pointId, prevPointId) || matchPointId(prevPointId, pointId)))
        const panorama = resolvePanoramaEmbed(target)
        if (sameAsPrev && map.getZoom() >= PANORAMA_TRIGGER_ZOOM && panorama) {
          setMapViewMode('panorama')
        } else if (isValidGeoPair(target.geo)) {
          focusGeo(target.geo, Math.max(map.getZoom(), 13.5), true)
        }
      }
      if (ctx.meStateRef.current) {
        fetch('/api/anitabi/me/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType: 'point', pointId }),
        }).catch(() => null)
      }
    }
    const handlePointerMove = (event: maplibregl.MapMouseEvent) => {
      const pointHit = readPointIdFromRendered(event)
      const completeHit = mapModeRef.current === 'complete' ? readCompleteTargetFromRendered(event) : null
      map.getCanvas().style.cursor = pointHit || completeHit ? 'pointer' : ''
    }
    const resetPointer = () => {
      map.getCanvas().style.cursor = ''
    }

    map.on('click', handlePointClick)
    map.on('mousemove', handlePointerMove)
    map.on('dragstart', resetPointer)
    map.on('mouseout', resetPointer)

    const resizeMap = () => map.resize()
    const flushLayers = () => {
      const pointOk = syncPointLayerRef.current()
      if (!pointOk) schedulePointLayerFallbackFlush()
      const rangeOk = syncRangeOverlayRef.current()
      if (!rangeOk) scheduleRangeOverlayFallbackFlush()
      syncCompleteModeRef.current()
    }
    const onMapStyleData = () => {
      flushLayers()
    }
    const onMapIdle = () => {
      clearStyleFailoverTimer()
      flushLayers()
    }
    const onMapError = (event: maplibregl.ErrorEvent) => {
      const msg = String((event as { error?: { message?: unknown } })?.error?.message || '').trim()
      if (!msg) return
      if (!/(401|403|429|unauthor|forbidden|access token|api key|quota|rate)/i.test(msg)) return

      const now = Date.now()
      if (now - styleErrorBurstRef.current.startedAt > MAP_STYLE_FAILOVER_ERROR_BURST_WINDOW_MS) {
        styleErrorBurstRef.current = { count: 1, startedAt: now }
      } else {
        styleErrorBurstRef.current = {
          count: styleErrorBurstRef.current.count + 1,
          startedAt: styleErrorBurstRef.current.startedAt || now,
        }
      }
      if (styleErrorBurstRef.current.count < MAP_STYLE_FAILOVER_ERROR_BURST_THRESHOLD) return

      styleErrorBurstRef.current = { count: 0, startedAt: now }
      const mode = currentStyleModeRef.current
      const candidates = getMapStyleCandidates(mode)
      const idx = styleProviderIndexRef.current[mode] || 0
      if (idx >= candidates.length - 1) return
      void switchStyleProvider(mode, idx + 1)
    }
    const missingStyleImageIds = new Set<string>()
    const onMapStyleImageMissing = (event: MapStyleImageMissingEvent) => {
      const imageId = String(event.id || '').trim()
      if (!imageId || shouldSkipMissingStyleImageFallback(imageId)) return
      if (map.hasImage(imageId)) return
      if (missingStyleImageIds.size >= MAP_STYLE_MISSING_IMAGE_FALLBACK_MAX && !missingStyleImageIds.has(imageId)) return
      try {
        map.addImage(imageId, {
          width: 1,
          height: 1,
          data: new Uint8Array([0, 0, 0, 0]),
        })
        missingStyleImageIds.add(imageId)
      } catch {
        // ignore duplicate/invalid image add attempts
      }
    }

    map.on('styledata', onMapStyleData)
    map.on('idle', onMapIdle)
    map.on('error', onMapError)
    map.on('styleimagemissing', onMapStyleImageMissing)
    map.once('load', () => {
      setMapReady(true)
      resizeMap()
      flushLayers()
    })
    const rafId = window.requestAnimationFrame(resizeMap)
    window.addEventListener('resize', resizeMap)

    mapRef.current = map
    if (mapInitWaitersRef.current.length > 0) {
      const waiters = mapInitWaitersRef.current.slice()
      mapInitWaitersRef.current = []
      for (const resume of waiters) resume()
    }

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resizeMap)
      if (focusTimerRef.current != null) {
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = null
      }
      if (userMarkerRef.current) {
        userMarkerRef.current.remove()
        userMarkerRef.current = null
      }
      map.off('click', handlePointClick)
      map.off('mousemove', handlePointerMove)
      map.off('dragstart', resetPointer)
      map.off('mouseout', resetPointer)
      map.off('moveend', syncMapViewState)
      map.off('zoomend', syncMapViewState)
      map.off('styledata', onMapStyleData)
      map.off('idle', onMapIdle)
      map.off('error', onMapError)
      map.off('styleimagemissing', onMapStyleImageMissing)
      clearStyleFailoverTimer()
      applyMapStyleRef.current = () => undefined
      removePointLayer(map)
      removeRangeLayer(map)
      removeCompleteModeLayers(map)
      removeLabelLayer(map)
      coverAvatarLoaderRef.current = null
      loadedCoverIdsRef.current = new Set()
      completeCoverFeatureCollectionRef.current = null
      completeCoverCandidatesRef.current = []
      map.remove()
      mapRef.current = null
      mapInitWaitersRef.current = []
    }
  }, [
    applyMapStyleRef,
    clearActiveBangumiSelectionRef,
    completeCoverCandidatesRef,
    completeCoverFeatureCollectionRef,
    coverAvatarLoaderRef,
    currentStyleModeRef,
    detailRef,
    focusGeo,
    focusTimerRef,
    isDesktopRef,
    loadedCoverIdsRef,
    mapInitWaitersRef,
    mapModeRef,
    mapRef,
    mapRootRef,
    openBangumiRef,
    parsed.lat,
    parsed.lng,
    parsed.z,
    schedulePointLayerFallbackFlush,
    scheduleRangeOverlayFallbackFlush,
    selectedPointIdRef,
    setDetailCardMode,
    setMapReady,
    setMapViewMode,
    setMapZoom,
    setMobilePointPopupOpen,
    setSelectedPointId,
    styleAttemptRef,
    styleErrorBurstRef,
    styleFailoverTimerRef,
    styleProviderIndexRef,
    syncCompleteModeRef,
    syncPointLayerRef,
    syncRangeOverlayRef,
    syncUrlRef,
    userMarkerRef,
  ])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (currentStyleModeRef.current === styleMode) return
    applyMapStyleRef.current(styleMode, { resetProvider: true, reason: 'mode-change' })
  }, [applyMapStyleRef, currentStyleModeRef, mapRef, styleMode])
}
