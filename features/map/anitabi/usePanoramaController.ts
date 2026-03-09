import { useCallback, useEffect } from 'react'
import { PANORAMA_TRIGGER_ZOOM } from './shared'
import { isValidGeoPair, resolvePanoramaEmbed } from './media'

export function usePanoramaController(ctx: any) {
  const {
    isDesktopRef,
    isDesktop,
    meStateRef,
    meState,
    selectedPointIdRef,
    selectedPointId,
    autoPanoramaDismissedRef,
    selectedPoint,
    detailRef,
    selectedPointPanorama,
    mapViewMode,
    setMapViewMode,
    setPanoramaError,
    setPanoramaLoading,
    setPanoramaProgress,
    panoramaProgressTimerRef,
    panoramaProgressDoneTimerRef,
    mapRef,
    mapZoom,
    setDetailCardMode,
    setSelectedPointId,
    label,
  } = ctx

  const clearPanoramaProgressTimers = useCallback(() => {
    if (panoramaProgressTimerRef.current != null) {
      window.clearInterval(panoramaProgressTimerRef.current)
      panoramaProgressTimerRef.current = null
    }
    if (panoramaProgressDoneTimerRef.current != null) {
      window.clearTimeout(panoramaProgressDoneTimerRef.current)
      panoramaProgressDoneTimerRef.current = null
    }
  }, [panoramaProgressDoneTimerRef, panoramaProgressTimerRef])

  const startPanoramaProgress = useCallback(() => {
    clearPanoramaProgressTimers()
    setPanoramaLoading(true)
    setPanoramaProgress(8)
    panoramaProgressTimerRef.current = window.setInterval(() => {
      setPanoramaProgress((prev: number) => {
        if (prev >= 92) return prev
        if (prev < 35) return Math.min(92, prev + 9)
        if (prev < 70) return Math.min(92, prev + 5)
        return Math.min(92, prev + 2)
      })
    }, 220)
  }, [clearPanoramaProgressTimers, panoramaProgressTimerRef, setPanoramaLoading, setPanoramaProgress])

  const finishPanoramaProgress = useCallback(() => {
    clearPanoramaProgressTimers()
    setPanoramaProgress(100)
    panoramaProgressDoneTimerRef.current = window.setTimeout(() => {
      setPanoramaLoading(false)
      panoramaProgressDoneTimerRef.current = null
    }, 280)
  }, [clearPanoramaProgressTimers, panoramaProgressDoneTimerRef, setPanoramaLoading, setPanoramaProgress])

  const failPanoramaProgress = useCallback(() => {
    clearPanoramaProgressTimers()
    setPanoramaLoading(false)
    setPanoramaProgress(0)
  }, [clearPanoramaProgressTimers, setPanoramaLoading, setPanoramaProgress])

  useEffect(() => {
    isDesktopRef.current = isDesktop
  }, [isDesktop, isDesktopRef])

  useEffect(() => {
    meStateRef.current = meState
  }, [meState, meStateRef])

  useEffect(() => {
    selectedPointIdRef.current = selectedPointId
  }, [selectedPointId, selectedPointIdRef])

  useEffect(() => {
    autoPanoramaDismissedRef.current = false
  }, [autoPanoramaDismissedRef, selectedPoint?.id])

  useEffect(() => () => {
    clearPanoramaProgressTimers()
  }, [clearPanoramaProgressTimers])

  useEffect(() => {
    if (!selectedPointPanorama && mapViewMode === 'panorama') {
      setMapViewMode('map')
    }
  }, [mapViewMode, selectedPointPanorama, setMapViewMode])

  useEffect(() => {
    if (mapViewMode !== 'map') return
    const map = mapRef.current
    if (!map) return
    const rafId = window.requestAnimationFrame(() => map.resize())
    return () => window.cancelAnimationFrame(rafId)
  }, [mapRef, mapViewMode])

  useEffect(() => {
    if (mapZoom < PANORAMA_TRIGGER_ZOOM) {
      autoPanoramaDismissedRef.current = false
      return
    }
    if (mapViewMode !== 'map') return
    if (autoPanoramaDismissedRef.current) return

    if (!selectedPointPanorama) {
      // Fallback: when a bangumi detail is open but no specific point is selected,
      // auto-pick the nearest point that supports panorama at high zoom.
      if (selectedPointIdRef.current) return
      const detailCard = detailRef.current
      if (!detailCard) return
      const center = mapRef.current?.getCenter()
      let nearestPointId: string | null = null
      let nearestDistance = Number.POSITIVE_INFINITY
      let firstAvailablePointId: string | null = null

      for (const point of detailCard.points) {
        if (!resolvePanoramaEmbed(point)) continue
        const pointId = String(point.id || '')
        if (!pointId) continue
        if (!firstAvailablePointId) firstAvailablePointId = pointId
        if (!center || !isValidGeoPair(point.geo)) continue
        const dLat = point.geo[0] - center.lat
        const dLng = point.geo[1] - center.lng
        const distance = dLat * dLat + dLng * dLng
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestPointId = pointId
        }
      }

      const targetPointId = nearestPointId || firstAvailablePointId
      if (!targetPointId) return
      setDetailCardMode('point')
      setSelectedPointId(targetPointId)
      return
    }

    setPanoramaError(null)
    setMapViewMode('panorama')
  }, [
    autoPanoramaDismissedRef,
    detailRef,
    mapRef,
    mapViewMode,
    mapZoom,
    selectedPointIdRef,
    selectedPointPanorama,
    setDetailCardMode,
    setMapViewMode,
    setPanoramaError,
    setSelectedPointId,
  ])

  useEffect(() => {
    if (mapViewMode !== 'panorama') {
      setPanoramaError(null)
      failPanoramaProgress()
      return
    }

    if (!selectedPointPanorama) {
      setPanoramaError(label.panoramaUnavailable)
      failPanoramaProgress()
      return
    }

    setPanoramaError(null)
    startPanoramaProgress()
  }, [
    failPanoramaProgress,
    label.panoramaUnavailable,
    mapViewMode,
    selectedPointPanorama,
    setPanoramaError,
    startPanoramaProgress,
  ])

  return {
    finishPanoramaProgress,
    failPanoramaProgress,
  }
}
