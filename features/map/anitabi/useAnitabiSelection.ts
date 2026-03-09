import { useCallback, useEffect, useRef } from 'react'
import type { AnitabiBangumiDTO } from '@/lib/anitabi/types'
import {
  buildWarmDetail,
  collectPointCoords,
  matchPointId,
  normalizeCoverImageUrl,
  prefetchImageUrl,
  warmPointImages,
} from './media'
import { pickFocusCluster } from './geo'
import { bangumiDetailCache, cachePut } from './shared'

let prefetchAbort: AbortController | null = null

export function useAnitabiSelection(ctx: any) {
  const {
    mapRef,
    syncUrlRef,
    selectedBangumiId,
    setSelectedBangumiId,
    selectedPointId,
    selectedPointIdRef,
    setSelectedPointId,
    query,
    tab,
    detail,
    detailRef,
    cards,
    setDetail,
    setDetailLoading,
    setDetailCardMode,
    setWorkDetailExpanded,
    setMapViewMode,
    setPanoramaError,
    setMobilePointPopupOpen,
    setMobilePanelOpen,
    isDesktop,
    locale,
    meStateRef,
    cacheStoreRef,
    tabCardsRef,
    warmPointIndexByBangumiIdRef,
    firstOpenPointGuardTimerRef,
    firstOpenPointStartedAtRef,
    firstOpenPointVisibleRecordedRef,
    activeBangumiIdRef,
    warmupMetricRef,
    flushPointLayerSoon,
    syncCompleteModeRef,
    focusGeo,
    fitBangumiBounds,
    openBangumiRef,
    clearActiveBangumiSelectionRef,
  } = ctx

  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearActiveBangumiSelection = useCallback((options?: { closeMobilePanel?: boolean }) => {
    activeBangumiIdRef.current = null
    detailRef.current = null
    setSelectedBangumiId(null)
    setDetail(null)
    setDetailCardMode('bangumi')
    setWorkDetailExpanded(false)
    setSelectedPointId(null)
    selectedPointIdRef.current = null
    setMobilePointPopupOpen(false)
    if (options?.closeMobilePanel) {
      setMobilePanelOpen(false)
    }
    setPanoramaError(null)
    setMapViewMode('map')
    flushPointLayerSoon()
    syncCompleteModeRef.current()
  }, [
    activeBangumiIdRef,
    detailRef,
    flushPointLayerSoon,
    selectedPointIdRef,
    setDetail,
    setDetailCardMode,
    setMapViewMode,
    setMobilePanelOpen,
    setMobilePointPopupOpen,
    setPanoramaError,
    setSelectedBangumiId,
    setSelectedPointId,
    setWorkDetailExpanded,
    syncCompleteModeRef,
  ])

  useEffect(() => {
    clearActiveBangumiSelectionRef.current = clearActiveBangumiSelection
  }, [clearActiveBangumiSelection, clearActiveBangumiSelectionRef])

  const syncUrl = useCallback(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams()
    if (selectedBangumiId != null) params.set('b', String(selectedBangumiId))
    if (selectedPointId) params.set('p', selectedPointId)
    if (query) params.set('q', query)
    if (tab !== 'nearby') params.set('tab', tab)

    const map = mapRef.current
    if (map) {
      const center = map.getCenter()
      params.set('mlng', center.lng.toFixed(6))
      params.set('lat', center.lat.toFixed(6))
      params.set('z', map.getZoom().toFixed(2))
    }

    const next = params.toString()
    const href = `${window.location.pathname}${next ? `?${next}` : ''}`
    window.history.replaceState(null, '', href)
  }, [mapRef, query, selectedBangumiId, selectedPointId, tab])

  useEffect(() => {
    syncUrlRef.current = syncUrl
  }, [syncUrl, syncUrlRef])

  useEffect(() => {
    detailRef.current = detail
  }, [detail, detailRef])

  const openBangumi = useCallback(
    async (id: number, pointId?: string | null, options?: { keepMobilePointPopup?: boolean }) => {
      if (firstOpenPointGuardTimerRef.current != null) {
        window.clearTimeout(firstOpenPointGuardTimerRef.current)
        firstOpenPointGuardTimerRef.current = null
      }
      firstOpenPointStartedAtRef.current = performance.now()
      firstOpenPointVisibleRecordedRef.current = false

      setSelectedBangumiId(id)
      activeBangumiIdRef.current = id
      setSelectedPointId(pointId || null)
      selectedPointIdRef.current = pointId || null
      setDetailCardMode(pointId ? 'point' : 'bangumi')
      setWorkDetailExpanded(false)
      setMapViewMode('map')
      if (!isDesktop) {
        setMobilePointPopupOpen(Boolean(options?.keepMobilePointPopup && pointId))
        setMobilePanelOpen(false)
      }
      setDetailLoading(true)
      const card = cards.find((c: { id: number }) => c.id === id)
        || Object.values(tabCardsRef.current).flatMap((rows: any) => rows || []).find((c: { id: number }) => c.id === id)
      const warmChunk = warmPointIndexByBangumiIdRef.current.get(id) || null
      const pushHistory = () => {
        if (!meStateRef.current) return
        fetch('/api/anitabi/me/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType: 'bangumi', bangumiId: id }),
        }).catch(() => null)
      }
      const focusByDetail = (nextDetail: AnitabiBangumiDTO, targetPointId?: string | null) => {
        const map = mapRef.current
        if (!map) return
        const geoPoints = collectPointCoords(nextDetail.points)
        const focusCluster = pickFocusCluster(geoPoints)
        const focusPoints = focusCluster.length ? focusCluster : geoPoints

        if (targetPointId) {
          const target = nextDetail.points.find((point) => matchPointId(point.id, targetPointId))
          if (target && target.id !== targetPointId) setSelectedPointId(target.id)
          if (!target) {
            setSelectedPointId(null)
            setDetailCardMode('bangumi')
          } else if (target.geo) {
            focusGeo(target.geo, Math.max(map.getZoom(), 13.5), true)
          } else {
            fitBangumiBounds(focusPoints)
          }
          return
        }

        if (focusPoints.length >= 2) {
          fitBangumiBounds(focusPoints)
        } else if (focusPoints.length === 1) {
          const single = focusPoints[0]!
          focusGeo([single[1], single[0]], Math.max(map.getZoom(), 12.8), true)
        } else if (nextDetail.card.geo) {
          focusGeo(nextDetail.card.geo, nextDetail.card.zoom || 10, true)
        }
      }

      if (card) {
        const warmDetail = buildWarmDetail(card, warmChunk)
        detailRef.current = warmDetail
        setDetail(warmDetail)
        if (warmDetail.points.length > 0) {
          warmPointImages(warmDetail.points)
          focusByDetail(warmDetail, pointId)
        }
        flushPointLayerSoon()
        syncCompleteModeRef.current()
      }

      try {
        if (!bangumiDetailCache.has(id) && cacheStoreRef.current) {
          try {
            const cachedL2 = await cacheStoreRef.current.getDetail(id)
            if (cachedL2) cachePut(id, cachedL2.detail)
          } catch {
            // ignore cache read failure
          }
        }
        const cached = bangumiDetailCache.get(id)
        if (cached) {
          detailRef.current = cached
          setDetail(cached)
          const cachedCover = normalizeCoverImageUrl(cached.card.cover)
          if (cachedCover) void prefetchImageUrl(cachedCover).catch(() => null)
          warmPointImages(cached.points)
          flushPointLayerSoon()
          focusByDetail(cached, pointId)
          syncCompleteModeRef.current()
          pushHistory()
          return
        }

        const res = await fetch(`/api/anitabi/bangumi/${id}?locale=${encodeURIComponent(locale)}`, { method: 'GET' })
        if (!res.ok) throw new Error('load detail failed')
        const json = (await res.json()) as AnitabiBangumiDTO
        cachePut(id, json)
        if (cacheStoreRef.current) {
          cacheStoreRef.current.getVersion().then((version: string | null) => {
            if (!version) return
            cacheStoreRef.current?.putDetail(id, {
              datasetVersion: version,
              bangumiId: id,
              detail: json,
              cachedAt: Date.now(),
            }).catch(() => null)
          }).catch(() => null)
        }
        if (activeBangumiIdRef.current !== id) return
        detailRef.current = json
        setDetail(json)
        const nextCover = normalizeCoverImageUrl(json.card.cover)
        if (nextCover) void prefetchImageUrl(nextCover).catch(() => null)
        warmPointImages(json.points)
        flushPointLayerSoon()
        focusByDetail(json, pointId)
        syncCompleteModeRef.current()
        pushHistory()
      } finally {
        firstOpenPointGuardTimerRef.current = window.setTimeout(() => {
          if (activeBangumiIdRef.current !== id) return
          if (firstOpenPointVisibleRecordedRef.current) return
          const currentMissing = Number(warmupMetricRef.current.first_open_point_missing || 0)
          warmupMetricRef.current.first_open_point_missing = currentMissing + 1
        }, 1800)
        setDetailLoading(false)
      }
    },
    [
      activeBangumiIdRef,
      cacheStoreRef,
      cards,
      detailRef,
      firstOpenPointGuardTimerRef,
      firstOpenPointStartedAtRef,
      firstOpenPointVisibleRecordedRef,
      fitBangumiBounds,
      flushPointLayerSoon,
      focusGeo,
      isDesktop,
      locale,
      mapRef,
      meStateRef,
      selectedPointIdRef,
      setDetail,
      setDetailCardMode,
      setDetailLoading,
      setMapViewMode,
      setMobilePanelOpen,
      setMobilePointPopupOpen,
      setSelectedBangumiId,
      setSelectedPointId,
      setWorkDetailExpanded,
      syncCompleteModeRef,
      tabCardsRef,
      warmPointIndexByBangumiIdRef,
      warmupMetricRef,
    ]
  )

  useEffect(() => {
    openBangumiRef.current = openBangumi
  }, [openBangumi, openBangumiRef])

  const prefetchBangumi = useCallback(
    (id: number) => {
      if (bangumiDetailCache.has(id)) return
      if (prefetchAbort) prefetchAbort.abort()
      const ac = new AbortController()
      prefetchAbort = ac
      fetch(`/api/anitabi/bangumi/${id}?locale=${encodeURIComponent(locale)}`, {
        method: 'GET',
        signal: ac.signal,
        // @ts-ignore -- RequestInit.priority is supported in modern browsers
        priority: 'low',
      })
        .then((res) => {
          if (!res.ok) return
          return res.json()
        })
        .then((json) => {
          if (json && !ac.signal.aborted) cachePut(id, json as AnitabiBangumiDTO)
        })
        .catch(() => null)
    },
    [locale]
  )

  const handleCardPointerEnter = useCallback((id: number) => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
    prefetchTimerRef.current = setTimeout(() => prefetchBangumi(id), 150)
  }, [prefetchBangumi])

  const handleCardPointerLeave = useCallback(() => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = null
    }
  }, [])

  useEffect(() => () => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
    if (prefetchAbort) prefetchAbort.abort()
    if (firstOpenPointGuardTimerRef.current != null) {
      window.clearTimeout(firstOpenPointGuardTimerRef.current)
      firstOpenPointGuardTimerRef.current = null
    }
  }, [firstOpenPointGuardTimerRef])

  useEffect(() => {
    if (selectedBangumiId == null) return
    if (ctx.detailLoading) return

    const sameBangumi = detail?.card.id === selectedBangumiId
    const samePoint = selectedPointId == null || ctx.selectedPoint != null
    if (sameBangumi && samePoint) return

    openBangumi(selectedBangumiId, selectedPointId).catch(() => null)
  }, [ctx.detailLoading, ctx.selectedPoint, detail?.card.id, openBangumi, selectedBangumiId, selectedPointId])

  return {
    syncUrl,
    openBangumi,
    clearActiveBangumiSelection,
    handleCardPointerEnter,
    handleCardPointerLeave,
  }
}
