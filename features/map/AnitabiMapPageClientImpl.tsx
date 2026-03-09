'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { AnitabiBangumiCard, AnitabiBangumiDTO, AnitabiBootstrapDTO, AnitabiMapTab, AnitabiPreloadChunkItemDTO, AnitabiPreloadManifestDTO } from '@/lib/anitabi/types'
import { resolvePointPopupAnchor } from '@/components/map/PointPopupCard'
import { useMapMode } from '@/components/map/hooks/useMapMode'
import { useMapInteractionActions } from './anitabi/useMapInteractionActions'
import AnitabiMapLayout from './anitabi/AnitabiMapLayout'
import { useAnitabiBootstrapData } from './anitabi/useAnitabiBootstrapData'
import { useAnitabiDerivedState } from './anitabi/useAnitabiDerivedState'
import { useAnitabiSelection } from './anitabi/useAnitabiSelection'
import { useAnitabiWarmup } from './anitabi/useAnitabiWarmup'
import { useCompleteMode } from './anitabi/useCompleteMode'
import { useMapCamera } from './anitabi/useMapCamera'
import { useMapStyleFailover } from './anitabi/useMapStyleFailover'
import { usePanoramaController } from './anitabi/usePanoramaController'
import { usePointAndRangeLayers } from './anitabi/usePointAndRangeLayers'
import { useWarmupProgressState } from './anitabi/useWarmupProgressState'
import {
  L,
  createEmptyWarmupTaskProgress,
  getApiErrorMessage,
  getRouteBookIdFromCreateResponse,
  hasSeenPointPoolHint,
  isRouteBookListItem,
  markPointPoolHintSeen,
  queryGeolocationPermissionState,
  readStoredUserLocation,
  readStoredUserLocationRaw,
  resolveImageBuildZoom,
  resolveImageShowZoom,
  resolveLocateZoom,
  writeStoredUserLocation,
} from './anitabi/shared'
import type {
  Props,
  MeState,
  SearchResult,
  RouteBookListItem,
  UserLocation,
  WarmupMetrics,
  WarmupProgress,
  WarmupTaskProgress,
} from './anitabi/shared'
import {
  extensionFromMimeType,
  isValidGeoPair,
  parseContentDispositionFilename,
  parseUrlState,
  sanitizeDownloadFileNameBase,
} from './anitabi/media'
import { formatDistance } from './anitabi/geo'
import type { WindowExcerptBangumiItem, WindowExcerptPointItem } from './anitabi/windowExcerpt'

export default function AnitabiMapPageClient({ locale, initialBootstrap }: Props) {
  const label = L[locale]
  const parsed = useMemo(() => parseUrlState(), [])

  const mapRootRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const syncUrlRef = useRef<() => void>(() => undefined)
  const syncPointLayerRef = useRef<() => boolean>(() => false)
  const syncRangeOverlayRef = useRef<() => boolean>(() => false)
  const syncCompleteModeRef = useRef<() => boolean>(() => false)
  const detailRef = useRef<AnitabiBangumiDTO | null>(null)
  const cardsContainerRef = useRef<HTMLDivElement | null>(null)
  const cardsLoadMoreRef = useRef<HTMLDivElement | null>(null)
  const cardFeedTokenRef = useRef(0)
  const focusTimerRef = useRef<number | null>(null)
  const rangeOverlayRef = useRef<{ data: GeoJSON.FeatureCollection<GeoJSON.Polygon>; color: string } | null>(null)
  const isDesktopRef = useRef(true)
  const meStateRef = useRef<MeState | null>(null)
  const selectedPointIdRef = useRef<string | null>(parsed.p)
  const autoPanoramaDismissedRef = useRef(false)
  const panoramaProgressTimerRef = useRef<number | null>(null)
  const panoramaProgressDoneTimerRef = useRef<number | null>(null)
  const autoLocateAttemptedRef = useRef(false)
  const activeBangumiIdRef = useRef<number | null>(null)
  const ssrBootstrapUsedRef = useRef(Boolean(initialBootstrap))
  const cacheStoreRef = useRef<any>(null)
  const warmupAbortRef = useRef<AbortController | null>(null)
  const spriteImageIdsRef = useRef<Set<string>>(new Set())
  const completeAbortRef = useRef<AbortController | null>(null)
  const completeFeatureCollectionRef = useRef<any>(null)
  const pointLayerFallbackTimerRef = useRef<number | null>(null)
  const rangeOverlayFallbackTimerRef = useRef<number | null>(null)
  const pendingPointGeoJsonRef = useRef<any>({ type: 'FeatureCollection', features: [] })
  const firstOpenPointStartedAtRef = useRef<number | null>(null)
  const firstOpenPointVisibleRecordedRef = useRef(false)
  const firstOpenPointGuardTimerRef = useRef<number | null>(null)
  const warmupMetricRef = useRef<WarmupMetrics>({})
  const warmupRunTokenRef = useRef(0)
  const warmupBlockingUiRef = useRef(true)
  const mapInitWaitersRef = useRef<Array<() => void>>([])
  const currentStyleModeRef = useRef<'street' | 'satellite'>('street')
  const styleProviderIndexRef = useRef<Record<'street' | 'satellite', number>>({ street: 0, satellite: 0 })
  const styleFailoverTimerRef = useRef<number | null>(null)
  const styleAttemptRef = useRef(0)
  const styleErrorBurstRef = useRef<{ count: number; startedAt: number }>({ count: 0, startedAt: 0 })
  const applyMapStyleRef = useRef<(mode: 'street' | 'satellite', options?: { resetProvider?: boolean; reason?: string }) => void>(() => undefined)
  const clearActiveBangumiSelectionRef = useRef<(() => void) | null>(null)
  const loadBootstrapFallbackRef = useRef<(() => Promise<void>) | null>(null)
  const loadMeRef = useRef<(() => Promise<void>) | null>(null)
  const preloadManifestRef = useRef<AnitabiPreloadManifestDTO | null>(null)
  const warmPointIndexByBangumiIdRef = useRef<Map<number, AnitabiPreloadChunkItemDTO>>(new Map())
  const tabCardsRef = useRef<Partial<Record<AnitabiMapTab, AnitabiBangumiCard[]>>>(
    initialBootstrap ? { [initialBootstrap.tab]: initialBootstrap.cards } : {}
  )
  const loadedTabsRef = useRef<Set<AnitabiMapTab>>(new Set(initialBootstrap ? [initialBootstrap.tab] : []))
  const coverAvatarLoaderRef = useRef<any>(null)
  const loadedCoverIdsRef = useRef<Set<string>>(new Set())
  const completeCoverFeatureCollectionRef = useRef<GeoJSON.FeatureCollection | null>(null)
  const completeCoverCandidatesRef = useRef<Array<{ bangumiId: number; coverUrl: string }>>([])
  const completePointImageLoaderRef = useRef<any>(null)
  const completePointImageSyncTokenRef = useRef(0)
  const completeBaseBuildVersionRef = useRef(-1)
  const completeSpriteBuildVersionRef = useRef(-1)
  const openBangumiRef = useRef<((id: number, pointId?: string | null, options?: { keepMobilePointPopup?: boolean }) => Promise<void>) | null>(null)
  const warmupProgressRef = useRef<WarmupProgress>({
    phase: 'idle',
    percent: 0,
    title: label.preloadTitle,
    detail: '',
  })
  const warmupTaskProgressRef = useRef<WarmupTaskProgress>(createEmptyWarmupTaskProgress())

  const [tab, setTab] = useState<AnitabiMapTab>(parsed.tab)
  const [queryInput, setQueryInput] = useState(parsed.q)
  const [query, setQuery] = useState(parsed.q)
  const [selectedCity, setSelectedCity] = useState('')
  const [selectedBangumiId, setSelectedBangumiId] = useState<number | null>(parsed.b)
  const [selectedPointId, setSelectedPointId] = useState<string | null>(parsed.p)
  const [detailCardMode, setDetailCardMode] = useState<'bangumi' | 'point'>(parsed.p ? 'point' : 'bangumi')
  const [viewFilter, setViewFilter] = useState<'all' | 'marked'>('all')
  const [stateFilter, setStateFilter] = useState<string[]>([])
  const [styleMode, setStyleMode] = useState<'street' | 'satellite'>('street')
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.innerWidth >= 1024
  })
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
  const [mobilePointPopupOpen, setMobilePointPopupOpen] = useState(false)
  const [mobilePointPopupAnchor, setMobilePointPopupAnchor] = useState<ReturnType<typeof resolvePointPopupAnchor> | null>(null)
  const [workDetailExpanded, setWorkDetailExpanded] = useState(false)
  const [windowExcerptPoints, setWindowExcerptPoints] = useState<WindowExcerptPointItem[]>([])
  const [windowExcerptBangumis, setWindowExcerptBangumis] = useState<WindowExcerptBangumiItem[]>([])
  const [bootstrap, setBootstrap] = useState<AnitabiBootstrapDTO | null>(initialBootstrap ?? null)
  const [cards, setCards] = useState<AnitabiBangumiCard[]>(initialBootstrap?.cards ?? [])
  const [detail, setDetail] = useState<AnitabiBangumiDTO | null>(null)
  const { mode: mapMode, setMode: setMapMode } = useMapMode()
  const mapModeRef = useRef(mapMode)
  const [loading, setLoading] = useState(false)
  const [loadingMoreCards, setLoadingMoreCards] = useState(false)
  const [cardsLoadError, setCardsLoadError] = useState<string | null>(null)
  const [hasMoreCards, setHasMoreCards] = useState(false)
  const [nextChunkIndex, setNextChunkIndex] = useState(1)
  const [detailLoading, setDetailLoading] = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult>({ bangumi: [], points: [], cities: [] })
  const [searchOpen, setSearchOpen] = useState(false)
  const [meState, setMeState] = useState<MeState | null>(null)
  const [locating, setLocating] = useState(false)
  const [locateHint, setLocateHint] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<UserLocation | null>(() => readStoredUserLocation())
  const [mapReady, setMapReady] = useState(false)
  const [mapZoom, setMapZoom] = useState(parsed.z)
  const [mapViewMode, setMapViewMode] = useState<'map' | 'panorama'>('map')
  const [panoramaError, setPanoramaError] = useState<string | null>(null)
  const [panoramaLoading, setPanoramaLoading] = useState(false)
  const [panoramaProgress, setPanoramaProgress] = useState(0)
  const [imagePreview, setImagePreview] = useState<{ src: string; name: string; saveUrl: string } | null>(null)
  const [imageSaving, setImageSaving] = useState(false)
  const [imageSaveError, setImageSaveError] = useState<string | null>(null)
  const [showCheckInCard, setShowCheckInCard] = useState(false)
  const [showRouteBookCard, setShowRouteBookCard] = useState(false)
  const [showComparisonGenerator, setShowComparisonGenerator] = useState(false)
  const [showQuickPilgrimage, setShowQuickPilgrimage] = useState(false)
  const [routeBookPickerOpen, setRouteBookPickerOpen] = useState(false)
  const [routeBookItems, setRouteBookItems] = useState<RouteBookListItem[]>([])
  const [routeBookPickerLoading, setRouteBookPickerLoading] = useState(false)
  const [completeModeLoading, setCompleteModeLoading] = useState(false)
  const [routeBookPickerSaving, setRouteBookPickerSaving] = useState(false)
  const [routeBookPickerError, setRouteBookPickerError] = useState<string | null>(null)
  const [routeBookTitleDraft, setRouteBookTitleDraft] = useState('')
  const [comparisonImageUrl, setComparisonImageUrl] = useState<string | null>(null)
  const [locationDialogOpen, setLocationDialogOpen] = useState(false)
  const [warmupProgress, setWarmupProgress] = useState<WarmupProgress>({
    phase: 'idle',
    percent: 0,
    title: label.preloadTitle,
    detail: '',
  })
  const [warmupTaskProgress, setWarmupTaskProgress] = useState<WarmupTaskProgress>(() => createEmptyWarmupTaskProgress())
  const [warmupUiBlocking, setWarmupUiBlocking] = useState(false)
  const [cacheStoreReady, setCacheStoreReady] = useState(false)
  const [tabCardsVersion, setTabCardsVersion] = useState(0)
  const [warmPointDataVersion, setWarmPointDataVersion] = useState(0)

  const completeImageBuildZoom = useMemo(
    () => resolveImageBuildZoom(mapZoom),
    [mapZoom]
  )
  const completeImageShowZoom = useMemo(
    () => resolveImageShowZoom(mapZoom),
    [mapZoom]
  )

  useEffect(() => {
    warmupProgressRef.current = warmupProgress
  }, [warmupProgress])

  useEffect(() => {
    warmupTaskProgressRef.current = warmupTaskProgress
  }, [warmupTaskProgress])

  const {
    detailPoints,
    quickPilgrimageProgress,
    quickPilgrimageStates,
    routeSummary,
    selectedPoint,
    selectedPointDistanceMeters,
    selectedPointImage,
    selectedPointPanorama,
    selectedPointState,
    shouldResetPointMode,
    showWantToGoAction,
  } = useAnitabiDerivedState({
    detail,
    detailCardMode,
    meState,
    selectedPointId,
    stateFilter,
    userLocation,
    viewFilter,
  })

  useEffect(() => {
    if (shouldResetPointMode) {
      setDetailCardMode('bangumi')
    }
  }, [shouldResetPointMode])

  useEffect(() => {
    if (isDesktop || mobilePanelOpen || !mobilePointPopupOpen || mapViewMode !== 'map' || !selectedPoint || !isValidGeoPair(selectedPoint.geo)) {
      setMobilePointPopupAnchor(null)
      return
    }

    const map = mapRef.current
    const mapRoot = mapRootRef.current
    if (!map || !mapRoot) {
      setMobilePointPopupAnchor(null)
      return
    }

    let frame = 0
    const syncAnchor = () => {
      const liveMap = mapRef.current
      const liveRoot = mapRootRef.current
      if (!liveMap || !liveRoot || !selectedPoint || !isValidGeoPair(selectedPoint.geo)) {
        setMobilePointPopupAnchor(null)
        return
      }

      const projected = liveMap.project([selectedPoint.geo[1], selectedPoint.geo[0]])
      const rect = liveRoot.getBoundingClientRect()
      const margin = 48
      const offscreen =
        projected.x < -margin
        || projected.x > rect.width + margin
        || projected.y < -margin
        || projected.y > rect.height + margin

      if (offscreen) {
        setMobilePointPopupAnchor(null)
        return
      }

      setMobilePointPopupAnchor(resolvePointPopupAnchor({
        x: projected.x,
        y: projected.y,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
      }))
    }

    const scheduleSync = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(syncAnchor)
    }

    syncAnchor()
    map.on('move', scheduleSync)
    map.on('zoom', scheduleSync)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      map.off('move', scheduleSync)
      map.off('zoom', scheduleSync)
    }
  }, [isDesktop, mapViewMode, mobilePanelOpen, mobilePointPopupOpen, selectedPoint])

  const { totalRouteDistance, checkedInThumbnails } = routeSummary

  const {
    completeAllWarmupTasks,
    resetWarmupTaskProgress,
    updateWarmupProgress,
    updateWarmupTask,
  } = useWarmupProgressState({
    label,
    setWarmupProgress,
    setWarmupTaskProgress,
    warmupBlockingUiRef,
    warmupMetricRef,
    warmupRunTokenRef,
  })

  const { focusGeo, fitBangumiBounds } = useMapCamera({
    mapRef,
    isDesktop,
    focusTimerRef,
  })

  const { finishPanoramaProgress, failPanoramaProgress } = usePanoramaController({
    autoPanoramaDismissedRef,
    detailRef,
    isDesktop,
    isDesktopRef,
    label,
    mapRef,
    mapViewMode,
    mapZoom,
    meState,
    meStateRef,
    panoramaProgressDoneTimerRef,
    panoramaProgressTimerRef,
    selectedPoint,
    selectedPointId,
    selectedPointIdRef,
    selectedPointPanorama,
    setDetailCardMode,
    setMapViewMode,
    setPanoramaError,
    setPanoramaLoading,
    setPanoramaProgress,
    setSelectedPointId,
  })

  const {
    flushPointLayerSoon,
    schedulePointLayerFallbackFlush,
    scheduleRangeOverlayFallbackFlush,
    syncRangeOverlay,
  } = usePointAndRangeLayers({
    detail,
    detailRef,
    firstOpenPointStartedAtRef,
    firstOpenPointVisibleRecordedRef,
    mapRef,
    meState,
    pendingPointGeoJsonRef,
    pointLayerFallbackTimerRef,
    rangeOverlayFallbackTimerRef,
    rangeOverlayRef,
    selectedPointId,
    stateFilter,
    syncPointLayerRef,
    syncRangeOverlayRef,
    viewFilter,
    warmupMetricRef,
  })

  const { openBangumi, clearActiveBangumiSelection, handleCardPointerEnter, handleCardPointerLeave, syncUrl } = useAnitabiSelection({
    activeBangumiIdRef,
    cacheStoreRef,
    cards,
    clearActiveBangumiSelectionRef,
    detail,
    detailLoading,
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
    openBangumiRef,
    query,
    selectedBangumiId,
    selectedPoint,
    selectedPointId,
    selectedPointIdRef,
    setDetail,
    setDetailCardMode,
    setDetailLoading,
    setMapViewMode,
    setMobilePanelOpen,
    setMobilePointPopupOpen,
    setPanoramaError,
    setSelectedBangumiId,
    setSelectedPointId,
    setWorkDetailExpanded,
    syncCompleteModeRef,
    syncUrlRef,
    tab,
    tabCardsRef,
    warmPointIndexByBangumiIdRef,
    warmupMetricRef,
  })

  useCompleteMode({
    completeAbortRef,
    completeBaseBuildVersionRef,
    completeCoverCandidatesRef,
    completeCoverFeatureCollectionRef,
    completeFeatureCollectionRef,
    completeImageBuildZoom,
    completeImageShowZoom,
    completePointImageLoaderRef,
    completePointImageSyncTokenRef,
    completeSpriteBuildVersionRef,
    coverAvatarLoaderRef,
    detail,
    detailRef,
    isDesktopRef,
    loadedCoverIdsRef,
    mapMode,
    mapModeRef,
    mapReady,
    mapRef,
    selectedPointId,
    setCompleteModeLoading,
    setWindowExcerptBangumis,
    setWindowExcerptPoints,
    spriteImageIdsRef,
    syncCompleteModeRef,
    tabCardsRef,
    warmPointDataVersion,
    warmPointIndexByBangumiIdRef,
    warmupMetricRef,
    warmupTaskProgress,
  })

  const warmupApi = useAnitabiWarmup({
    activeBangumiIdRef,
    cacheStoreRef,
    completeAllWarmupTasks,
    label,
    loadedTabsRef,
    locale,
    mapInitWaitersRef,
    mapRef,
    preloadManifestRef,
    resetWarmupTaskProgress,
    setBootstrap,
    setCardsLoadError,
    setDetail,
    setLoading,
    setTabCardsVersion,
    setWarmPointDataVersion,
    setWarmupProgress,
    setWarmupUiBlocking,
    tab,
    tabCardsRef,
    updateWarmupProgress,
    updateWarmupTask,
    warmPointIndexByBangumiIdRef,
    warmupBlockingUiRef,
    warmupMetricRef,
    warmupRunTokenRef,
  })

  const { loadMe, loadBootstrap, loadMoreCards } = useAnitabiBootstrapData({
    cacheStoreReady,
    cacheStoreRef,
    cardFeedTokenRef,
    cardsContainerRef,
    cardsLoadMoreRef,
    hasMoreCards,
    hydrateTabCardsFromCache: warmupApi.hydrateTabCardsFromCache,
    initialBootstrap,
    label,
    loadedTabsRef,
    loading,
    loadingMoreCards,
    locale,
    nextChunkIndex,
    query,
    queryInput,
    resetWarmupTaskProgress,
    searchResult,
    selectedCity,
    setBootstrap,
    setCacheStoreReady,
    setCards,
    setCardsLoadError,
    setHasMoreCards,
    setLoading,
    setLoadingMoreCards,
    setMeState,
    setNextChunkIndex,
    setSearchResult,
    setTab,
    setTabCardsVersion,
    setWarmupUiBlocking,
    loadBootstrapFallbackRef,
    loadMeRef,
    ssrBootstrapUsedRef,
    tab,
    tabCardsRef,
    userLocation,
    updateWarmupProgress,
    warmupAbortRef,
    warmupAllTabsData: warmupApi.warmupAllTabsData,
    warmupBlockingUiRef,
    warmupMetricRef,
    warmupProgress,
    warmupProgressRef,
    warmupRunTokenRef,
    warmupTaskProgressRef,
    warmPointIndexByBangumiIdRef,
  })

  useMapStyleFailover({
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
    meStateRef,
    openBangumiRef,
    parsed,
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
    styleMode,
    styleProviderIndexRef,
    syncCompleteModeRef,
    syncPointLayerRef,
    syncRangeOverlayRef,
    syncUrlRef,
    userMarkerRef,
  })

  useEffect(() => {
    if (warmupProgress.phase !== 'loading') return
    if (warmupProgress.percent < 100) return
    const timer = window.setTimeout(() => {
      warmupBlockingUiRef.current = false
      setWarmupUiBlocking(false)
      setWarmupProgress((prev) => {
        if (prev.phase !== 'loading' || prev.percent < 100) return prev
        return { ...prev, phase: 'done', percent: 100, detail: prev.detail || label.preloadDone }
      })
      window.setTimeout(() => {
        setWarmupProgress((prev) => (
          prev.phase === 'done'
            ? { ...prev, phase: 'idle', percent: 100, detail: prev.detail || label.preloadDone }
            : prev
        ))
      }, 450)
    }, 650)
    return () => window.clearTimeout(timer)
  }, [label.preloadDone, warmupProgress.percent, warmupProgress.phase])

  useEffect(() => {
    syncUrl()
  }, [syncUrl])

  const {
    onSubmitQuery,
    onRandom,
    enterPanorama,
    onImagePreviewOpenChange,
    renderPointImage,
    saveOriginalImage,
    exitPanorama,
    onLocate,
    locateUser,
    onShare,
    addPointToPointPool,
    openRouteBookPicker,
    addSelectedPointToRouteBook,
    createRouteBookAndAddPoint,
    switchToBangumiDetail,
  } = useMapInteractionActions({
    locateHint,
    setLocateHint,
    setIsDesktop,
    setMobilePanelOpen,
    mapRef,
    isDesktop,
    mobilePanelOpen,
    selectedPoint,
    queryInput,
    setQuery,
    cards,
    openBangumi,
    selectedPointPanorama,
    setPanoramaError,
    setMapViewMode,
    isDesktopRef,
    setMobilePointPopupOpen,
    setImageSaving,
    setImageSaveError,
    setImagePreview,
    setLocating,
    label,
    imagePreview,
    imageSaving,
    parseContentDispositionFilename,
    sanitizeDownloadFileNameBase,
    extensionFromMimeType,
    mapZoom,
    autoPanoramaDismissedRef,
    userMarkerRef,
    focusGeo,
    resolveLocateZoom,
    setUserLocation,
    writeStoredUserLocation,
    mapReady,
    userLocation,
    parsed,
    autoLocateAttemptedRef,
    readStoredUserLocationRaw,
    queryGeolocationPermissionState,
    setTab,
    setLocationDialogOpen,
    syncUrlRef,
    getApiErrorMessage,
    loadMe,
    hasSeenPointPoolHint,
    markPointPoolHintSeen,
    setRouteBookPickerLoading,
    setRouteBookPickerError,
    setRouteBookPickerOpen,
    setRouteBookItems,
    isRouteBookListItem,
    setRouteBookPickerSaving,
    routeBookTitleDraft,
    getRouteBookIdFromCreateResponse,
    setRouteBookTitleDraft,
    setDetailCardMode,
    setSelectedPointId,
  })

  return (
    <AnitabiMapLayout
      addPointToPointPool={addPointToPointPool}
      addSelectedPointToRouteBook={addSelectedPointToRouteBook}
      bootstrap={bootstrap}
      cards={cards}
      cardsContainerRef={cardsContainerRef}
      cardsLoadError={cardsLoadError}
      cardsLoadMoreRef={cardsLoadMoreRef}
      checkedInThumbnails={checkedInThumbnails}
      clearActiveBangumiSelection={clearActiveBangumiSelection}
      completeModeLoading={completeModeLoading}
      comparisonImageUrl={comparisonImageUrl}
      createRouteBookAndAddPoint={createRouteBookAndAddPoint}
      detail={detail}
      detailCardMode={detailCardMode}
      detailLoading={detailLoading}
      detailPoints={detailPoints}
      enterPanorama={enterPanorama}
      exitPanorama={exitPanorama}
      failPanoramaProgress={failPanoramaProgress}
      finishPanoramaProgress={finishPanoramaProgress}
      focusGeo={focusGeo}
      formatDistance={formatDistance}
      hasMoreCards={hasMoreCards}
      hasSearchQuery={query.trim().length > 0}
      handleCardPointerEnter={handleCardPointerEnter}
      handleCardPointerLeave={handleCardPointerLeave}
      imagePreview={imagePreview}
      imageSaveError={imageSaveError}
      imageSaving={imageSaving}
      isDesktop={isDesktop}
      isDesktopRef={isDesktopRef}
      label={label}
      loadMe={loadMe}
      loadMoreCards={loadMoreCards}
      loading={loading}
      loadingMoreCards={loadingMoreCards}
      locateHint={locateHint}
      locateUser={locateUser}
      locating={locating}
      locale={locale}
      locationDialogOpen={locationDialogOpen}
      mapMode={mapMode}
      mapRef={mapRef}
      mapRootRef={mapRootRef}
      mapViewMode={mapViewMode}
      meState={meState}
      mobilePanelOpen={mobilePanelOpen}
      mobilePointPopupAnchor={mobilePointPopupAnchor}
      mobilePointPopupOpen={mobilePointPopupOpen}
      onImagePreviewOpenChange={onImagePreviewOpenChange}
      onLocate={onLocate}
      onRandom={onRandom}
      onShare={onShare}
      onSubmitQuery={onSubmitQuery}
      openBangumi={openBangumi}
      openRouteBookPicker={openRouteBookPicker}
      panoramaError={panoramaError}
      panoramaLoading={panoramaLoading}
      panoramaProgress={panoramaProgress}
      query={query}
      queryInput={queryInput}
      quickPilgrimageProgress={quickPilgrimageProgress}
      quickPilgrimageStates={quickPilgrimageStates}
      routeBookItems={routeBookItems}
      routeBookPickerError={routeBookPickerError}
      routeBookPickerLoading={routeBookPickerLoading}
      routeBookPickerOpen={routeBookPickerOpen}
      routeBookPickerSaving={routeBookPickerSaving}
      routeBookTitleDraft={routeBookTitleDraft}
      saveOriginalImage={saveOriginalImage}
      searchOpen={searchOpen}
      searchResult={searchResult}
      selectedBangumiId={selectedBangumiId}
      selectedCity={selectedCity}
      selectedPoint={selectedPoint}
      selectedPointDistanceMeters={selectedPointDistanceMeters}
      selectedPointId={selectedPointId}
      selectedPointImage={selectedPointImage}
      selectedPointPanorama={selectedPointPanorama}
      selectedPointPanoramaAvailable={Boolean(selectedPointPanorama)}
      selectedPointState={selectedPointState}
      setComparisonImageBlob={() => undefined}
      setComparisonImageUrl={setComparisonImageUrl}
      setDetailCardMode={setDetailCardMode}
      setLocationDialogOpen={setLocationDialogOpen}
      setMapMode={setMapMode}
      setMapViewMode={setMapViewMode}
      setMobilePanelOpen={setMobilePanelOpen}
      setMobilePointPopupOpen={setMobilePointPopupOpen}
      setPanoramaError={setPanoramaError}
      setQuery={setQuery}
      setQueryInput={setQueryInput}
      setRouteBookPickerOpen={setRouteBookPickerOpen}
      setRouteBookTitleDraft={setRouteBookTitleDraft}
      setSearchOpen={setSearchOpen}
      setSelectedCity={setSelectedCity}
      setSelectedPointId={setSelectedPointId}
      setShowCheckInCard={setShowCheckInCard}
      setShowComparisonGenerator={setShowComparisonGenerator}
      setShowQuickPilgrimage={setShowQuickPilgrimage}
      setShowRouteBookCard={setShowRouteBookCard}
      setStateFilter={setStateFilter}
      setStyleMode={setStyleMode}
      setTab={setTab}
      setViewFilter={setViewFilter}
      setWorkDetailExpanded={setWorkDetailExpanded}
      showCheckInCard={showCheckInCard}
      showComparisonGenerator={showComparisonGenerator}
      showNearbyLocationCta={!loading && tab === 'nearby' && !userLocation}
      showQuickPilgrimage={showQuickPilgrimage}
      showRouteBookCard={showRouteBookCard}
      showWantToGoAction={showWantToGoAction}
      stateFilter={stateFilter}
      styleMode={styleMode}
      switchToBangumiDetail={switchToBangumiDetail}
      tab={tab}
      totalRouteDistance={totalRouteDistance}
      viewFilter={viewFilter}
      warmupProgress={warmupProgress}
      warmupUiBlocking={warmupUiBlocking}
      windowExcerptBangumis={windowExcerptBangumis}
      windowExcerptPoints={windowExcerptPoints}
      workDetailExpanded={workDetailExpanded}
      renderPointImage={renderPointImage}
    />
  )
}
