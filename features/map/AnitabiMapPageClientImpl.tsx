'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import maplibregl, { type MapStyleImageMissingEvent } from 'maplibre-gl'
import type { SupportedLocale } from '@/lib/i18n/types'
import type {
  AnitabiBangumiCard,
  AnitabiBangumiDTO,
  AnitabiBootstrapDTO,
  AnitabiMapTab,
  AnitabiPreloadChunkItemDTO,
  AnitabiPreloadManifestDTO,
} from '@/lib/anitabi/types'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import CheckInCard from '@/components/share/CheckInCard'
import RouteBookCard from '@/components/share/RouteBookCard'
import ComparisonImageGenerator from '@/components/comparison/ComparisonImageGenerator'
import QuickPilgrimageMode from '@/components/quickPilgrimage/QuickPilgrimageMode'
import MapLoadingProgress from '@/components/map/MapLoadingProgress'
import { createCacheStore } from '@/lib/anitabi/client/clientCache'
import type { CacheStore } from '@/lib/anitabi/client/types'
import { isValidTheme } from '@/components/map/types'
import type { AnitabiTheme } from '@/components/map/types'
import { createGlobalFeatureCollection } from '@/components/map/utils/globalFeatureCollection'
import type { InputPoint } from '@/components/map/utils/globalFeatureCollection'
import { cutSpriteSheet } from '@/components/map/utils/spriteRenderer'
import type { ImageLoader } from '@/components/map/utils/spriteRenderer'
import { CoverAvatarLoader } from '@/components/map/utils/coverAvatarLoader'
import { toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'
import {
  COMPLETE_BANGUMI_COVERS_LAYER_ID,
  COMPLETE_DOTS_LAYER_ID,
  COMPLETE_ICONS_LAYER_ID,
  COMPLETE_THEME_FALLBACK_LAYER_ID,
  COMPLETE_POINT_IMAGES_LAYER_ID,
  ensureCompleteModeSources,
  ensureCompleteModeSymbolLayer,
  updateCompleteModeLayerVisibility,
  updateCompleteModePointImageSource,
  updateCompleteModeSources,
  updateCompleteModeThemeSource,
  updateCompleteModeCoverSource,
  removeCompleteModeLayers,
  ensureLabelLayer,
  updateLabelSource,
  removeLabelLayer,
  buildLabelFeatureCollection,
} from '@/components/map/CompleteModeLayers'
import { ThumbnailLoader } from '@/components/map/utils/thumbnailLoader'
import type { GlobalPointFeatureProperties } from '@/components/map/types'
import { MapModeToggle } from '@/components/map/MapModeToggle'
import { useMapMode } from '@/components/map/hooks/useMapMode'
import {
  L,
  CARD_PAGE_SIZE,
  CARD_LIST_PREFETCH_ROOT_MARGIN,
  RANGE_SOURCE_ID,
  RANGE_FILL_LAYER_ID,
  RANGE_LINE_LAYER_ID,
  POINT_SOURCE_ID,
  POINT_LAYER_ID,
  POINT_SELECTED_HALO_LAYER_ID,
  POINT_SELECTED_LAYER_ID,
  DETAIL_PANEL_WIDTH,
  DESKTOP_BREAKPOINT,
  PANORAMA_TRIGGER_ZOOM,
  LOCATION_DIALOG_DISMISSED_KEY,
  WARMUP_BLOCKING_BUDGET_MS,
  PRELOAD_CHUNK_CONCURRENCY,
  PRELOAD_IMAGE_BLOCKING_MAX,
  PRELOAD_IMAGE_BACKGROUND_MAX,
  WARMUP_IMAGE_TIMEOUT_MS,
  WARMUP_PRELOAD_FETCH_TIMEOUT_MS,
  WARMUP_ACTIVE_DETAIL_IMAGE_MAX,
  WARMUP_MAP_WAIT_TIMEOUT_MS,
  WARMUP_MAP_READY_TIMEOUT_MS,
  WARMUP_WATCHDOG_INTERVAL_MS,
  WARMUP_STALL_WARN_MS,
  COMPLETE_MODE_SPRITE_MAX_BANGUMI,
  COMPLETE_MODE_SPRITE_BUDGET_MS,
  COMPLETE_MODE_COVER_CANDIDATES_MAX,
  COMPLETE_MODE_COVER_MAX_LOADED,
  COMPLETE_AVATAR_MAX_ZOOM,
  COMPLETE_DETAIL_THEME_MIN_ZOOM,
  COMPLETE_DETAIL_THEME_MAX_ZOOM,
  WARMUP_TASK_WEIGHTS,
  MAP_PRELOAD_V2_ENABLED,
  MAP_STYLE_FAILOVER_TIMEOUT_MS,
  MAP_STYLE_FAILOVER_ERROR_BURST_WINDOW_MS,
  MAP_STYLE_FAILOVER_ERROR_BURST_THRESHOLD,
  MAP_STYLE_MISSING_IMAGE_FALLBACK_MAX,
  bangumiDetailCache,
  cachePut,
  prefetchedPointImageUrls,
  prefetchingPointImageUrls,
  shouldSkipMissingStyleImageFallback,
  createEmptyWarmupTaskProgress,
  resolveLocateZoom,
  resolveImageBuildZoom,
  resolveImageShowZoom,
  readStoredUserLocation,
  readStoredUserLocationRaw,
  writeStoredUserLocation,
  hasSeenPointPoolHint,
  markPointPoolHintSeen,
  queryGeolocationPermissionState,
  isRouteBookListItem,
  getApiErrorMessage,
  getRouteBookIdFromCreateResponse,
  normalizeSearchKeyword,
  filterBulkCardsBySearch,
} from './anitabi/shared'
import type {
  Props,
  PointState,
  MeState,
  UserLocation,
  SearchResult,
  RouteBookListItem,
  WarmupProgress,
  WarmupTaskProgress,
  WarmupTaskKey,
  WarmupMetrics,
  CameraPadding,
  PointCoord,
  PointFeatureProperties,
  MapStyleMode,
  MapStyleCandidate,
} from './anitabi/shared'
import {
  parseUrlState,
  sanitizeDownloadFileNameBase,
  parseContentDispositionFilename,
  extensionFromMimeType,
  normalizePointImageUrl,
  normalizePointImageSaveUrl,
  normalizeCoverImageUrl,
  createRequestSignalWithTimeout,
  withPromiseTimeout,
  yieldToMainThread,
  prefetchImageUrl,
  warmPointImages,
  looksLikeImageUrl,
  buildFallbackRasterStyle,
  getMapStyleCandidates,
  geoLink,
  resolvePanoramaEmbed,
  matchPointId,
  isValidGeoPair,
  collectPointCoords,
  buildPointFeatureCollection,
  createEmptyPointFeatureCollection,
  getImageWarmupConcurrency,
  buildWarmDetail,
} from './anitabi/media'
import {
  distanceMeters,
  formatDistance,
  clamp,
  buildCoverageArea,
  buildDistanceClusters,
  pickFocusCluster,
  buildBounds,
  removeRangeLayer,
  removePointLayer,
  hexToRgba,
} from './anitabi/geo'
import { useMapInteractionActions } from './anitabi/useMapInteractionActions'

let prefetchAbort: AbortController | null = null

export default function AnitabiMapPageClient({ locale, initialBootstrap }: Props) {
  const label = L[locale]

  const parsed = useMemo(() => parseUrlState(), [])

  const mapRootRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const syncUrlRef = useRef<() => void>(() => undefined)
  const syncPointLayerRef = useRef<() => boolean>(() => false)
  const syncRangeOverlayRef = useRef<() => boolean>(() => false)
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
  const cacheStoreRef = useRef<CacheStore | null>(null)
  const warmupAbortRef = useRef<AbortController | null>(null)
  const syncCompleteModeRef = useRef<() => boolean>(() => false)
  const spriteImageIdsRef = useRef<Set<string>>(new Set())
  const completeAbortRef = useRef<AbortController | null>(null)
  const completeFeatureCollectionRef = useRef<ReturnType<typeof createGlobalFeatureCollection> | null>(null)
  const pointLayerFallbackTimerRef = useRef<number | null>(null)
  const rangeOverlayFallbackTimerRef = useRef<number | null>(null)
  const pendingPointGeoJsonRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Point, PointFeatureProperties>>(createEmptyPointFeatureCollection())
  const firstOpenPointStartedAtRef = useRef<number | null>(null)
  const firstOpenPointVisibleRecordedRef = useRef(false)
  const firstOpenPointGuardTimerRef = useRef<number | null>(null)
  const warmupMetricRef = useRef<WarmupMetrics>({})
  const warmupRunTokenRef = useRef(0)
  const warmupBlockingUiRef = useRef(true)
  const mapInitWaitersRef = useRef<Array<() => void>>([])
  const currentStyleModeRef = useRef<'street' | 'satellite'>('street')
  const styleProviderIndexRef = useRef<Record<MapStyleMode, number>>({ street: 0, satellite: 0 })
  const styleFailoverTimerRef = useRef<number | null>(null)
  const styleAttemptRef = useRef(0)
  const styleErrorBurstRef = useRef<{ count: number; startedAt: number }>({ count: 0, startedAt: 0 })
  const applyMapStyleRef = useRef<(mode: MapStyleMode, options?: { resetProvider?: boolean; reason?: string }) => void>(() => undefined)
  const preloadManifestRef = useRef<AnitabiPreloadManifestDTO | null>(null)
  const warmPointIndexByBangumiIdRef = useRef<Map<number, AnitabiPreloadChunkItemDTO>>(new Map())
  const tabCardsRef = useRef<Partial<Record<AnitabiMapTab, AnitabiBangumiCard[]>>>(
    initialBootstrap ? { [initialBootstrap.tab]: initialBootstrap.cards } : {}
  )
  const loadedTabsRef = useRef<Set<AnitabiMapTab>>(new Set(initialBootstrap ? [initialBootstrap.tab] : []))
  const coverAvatarLoaderRef = useRef<CoverAvatarLoader | null>(null)
  const loadedCoverIdsRef = useRef<Set<string>>(new Set())
  const completeCoverFeatureCollectionRef = useRef<GeoJSON.FeatureCollection | null>(null)
  const completeCoverCandidatesRef = useRef<Array<{ bangumiId: number; coverUrl: string }>>([])
  const completePointImageLoaderRef = useRef<ThumbnailLoader | null>(null)
  const completePointImageSyncTokenRef = useRef(0)

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
    return window.innerWidth >= DESKTOP_BREAKPOINT
  })
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
  const [mobilePointPopupOpen, setMobilePointPopupOpen] = useState(false)
  const [workDetailExpanded, setWorkDetailExpanded] = useState(false)

  const [bootstrap, setBootstrap] = useState<AnitabiBootstrapDTO | null>(initialBootstrap ?? null)
  const [cards, setCards] = useState<AnitabiBangumiCard[]>(initialBootstrap?.cards ?? [])
  const [detail, setDetail] = useState<AnitabiBangumiDTO | null>(null)
  const { mode: mapMode, setMode: setMapMode, isComplete } = useMapMode()
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
  const [comparisonImageBlob, setComparisonImageBlob] = useState<Blob | null>(null)
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
  const warmupProgressRef = useRef<WarmupProgress>(warmupProgress)
  const warmupTaskProgressRef = useRef<WarmupTaskProgress>(warmupTaskProgress)
  const completeImageBuildZoom = useMemo(
    () => resolveImageBuildZoom(PANORAMA_TRIGGER_ZOOM),
    []
  )
  const completeImageShowZoom = useMemo(
    () => resolveImageShowZoom(PANORAMA_TRIGGER_ZOOM),
    []
  )

  useEffect(() => {
    warmupProgressRef.current = warmupProgress
  }, [warmupProgress])

  useEffect(() => {
    warmupTaskProgressRef.current = warmupTaskProgress
  }, [warmupTaskProgress])

  const selectedPoint = useMemo(() => {
    if (!detail || !selectedPointId) return null
    return detail.points.find((point) => matchPointId(point.id, selectedPointId)) || null
  }, [detail, selectedPointId])

  // Keep imperative map callbacks aligned with the latest selection state.
  detailRef.current = detail
  selectedPointIdRef.current = selectedPointId

  useEffect(() => {
    if (detailCardMode === 'point' && !selectedPoint) {
      setDetailCardMode('bangumi')
    }
  }, [detailCardMode, selectedPoint])

  const selectedPointState = useMemo(() => {
    if (!selectedPoint || !meState) return null
    return meState.pointStates.find((ps) => ps.pointId === selectedPoint.id)?.state || null
  }, [meState, selectedPoint])

  const showWantToGoAction = Boolean(selectedPoint && selectedPointState === null)

  const quickPilgrimageStates = useMemo(() => {
    const out: Record<string, string> = {}
    for (const row of meState?.pointStates || []) {
      out[row.pointId] = row.state
    }
    return out
  }, [meState])

  const quickPilgrimageProgress = useMemo(() => {
    if (!detail) return { checked: 0, total: 0 }
    const checked = detail.points.filter((point) => quickPilgrimageStates[point.id] === 'checked_in').length
    return { checked, total: detail.points.length }
  }, [detail, quickPilgrimageStates])

  const detailPoints = useMemo(() => {
    if (!detail) return [] as Array<{ point: AnitabiBangumiDTO['points'][number]; distanceMeters: number | null }>

    const origin: PointCoord | null = userLocation ? [userLocation.lng, userLocation.lat] : null
    const ranked = detail.points
      .filter((point) => {
        const userState = meState?.pointStates.find((ps) => ps.pointId === point.id)?.state || 'none'
        if (viewFilter === 'marked' && userState === 'none') return false
        if (stateFilter.length > 0 && !stateFilter.includes(userState)) return false
        return true
      })
      .map((point, index) => {
        const pointCoord: PointCoord | null = isValidGeoPair(point.geo) ? [point.geo[1], point.geo[0]] : null
        const pointDistance = origin && pointCoord ? distanceMeters(origin, pointCoord) : null
        return {
          point,
          distanceMeters: pointDistance,
          index,
        }
      })

    ranked.sort((a, b) => {
      if (a.distanceMeters != null && b.distanceMeters != null) {
        if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters
      } else if (a.distanceMeters != null) {
        return -1
      } else if (b.distanceMeters != null) {
        return 1
      }
      return a.index - b.index
    })

    return ranked.map(({ point, distanceMeters: pointDistance }) => ({ point, distanceMeters: pointDistance }))
  }, [detail, userLocation, meState, viewFilter, stateFilter])

  const selectedPointDistanceMeters = useMemo(() => {
    if (!selectedPoint || !userLocation || !isValidGeoPair(selectedPoint.geo)) return null
    return distanceMeters([userLocation.lng, userLocation.lat], [selectedPoint.geo[1], selectedPoint.geo[0]])
  }, [selectedPoint, userLocation])

  const selectedPointPanorama = useMemo(() => {
    if (!selectedPoint) return null
    return resolvePanoramaEmbed(selectedPoint)
  }, [selectedPoint])

  const selectedPointImage = useMemo(() => {
    if (!selectedPoint) return { previewUrl: null as string | null, downloadUrl: null as string | null }

    const previewUrl = normalizePointImageUrl(selectedPoint.image)
    const originUrl = String(selectedPoint.originUrl || '').trim()
    // Use stripped URL for download (full resolution)
    const downloadUrl = looksLikeImageUrl(originUrl) ? normalizePointImageSaveUrl(originUrl) : normalizePointImageSaveUrl(selectedPoint.image)

    return { previewUrl, downloadUrl }
  }, [selectedPoint])

  const { isBangumiCompleted, totalRouteDistance, checkedInThumbnails } = useMemo(() => {
    if (!detail || !meState) {
      return { isBangumiCompleted: false, totalRouteDistance: '0 km', checkedInThumbnails: [] as string[] }
    }
    const checkedInPoints = detail.points.filter((p) =>
      meState.pointStates.find((ps) => ps.pointId === p.id && ps.state === 'checked_in')
    )
    const isCompleted = checkedInPoints.length === detail.points.length && detail.points.length > 0
    
    let meters = 0
    for (let i = 0; i < detail.points.length - 1; i++) {
      const p1 = detail.points[i]
      const p2 = detail.points[i + 1]
      if (p1?.geo && p2?.geo) {
        meters += distanceMeters([p1.geo[1], p1.geo[0]], [p2.geo[1], p2.geo[0]])
      }
    }

    const thumbnails = checkedInPoints
      .map(p => normalizePointImageUrl(p.image))
      .filter((src): src is string => !!src)
      .slice(0, 3)

    return { 
      isBangumiCompleted: isCompleted, 
      totalRouteDistance: formatDistance(meters),
      checkedInThumbnails: thumbnails
    }
  }, [detail, meState])

  const clearPanoramaProgressTimers = useCallback(() => {
    if (panoramaProgressTimerRef.current != null) {
      window.clearInterval(panoramaProgressTimerRef.current)
      panoramaProgressTimerRef.current = null
    }
    if (panoramaProgressDoneTimerRef.current != null) {
      window.clearTimeout(panoramaProgressDoneTimerRef.current)
      panoramaProgressDoneTimerRef.current = null
    }
  }, [])

  const startPanoramaProgress = useCallback(() => {
    clearPanoramaProgressTimers()
    setPanoramaLoading(true)
    setPanoramaProgress(8)
    panoramaProgressTimerRef.current = window.setInterval(() => {
      setPanoramaProgress((prev) => {
        if (prev >= 92) return prev
        if (prev < 35) return Math.min(92, prev + 9)
        if (prev < 70) return Math.min(92, prev + 5)
        return Math.min(92, prev + 2)
      })
    }, 220)
  }, [clearPanoramaProgressTimers])

  const finishPanoramaProgress = useCallback(() => {
    clearPanoramaProgressTimers()
    setPanoramaProgress(100)
    panoramaProgressDoneTimerRef.current = window.setTimeout(() => {
      setPanoramaLoading(false)
      panoramaProgressDoneTimerRef.current = null
    }, 280)
  }, [clearPanoramaProgressTimers])

  const failPanoramaProgress = useCallback(() => {
    clearPanoramaProgressTimers()
    setPanoramaLoading(false)
    setPanoramaProgress(0)
  }, [clearPanoramaProgressTimers])

  useEffect(() => {
    isDesktopRef.current = isDesktop
  }, [isDesktop])

  useEffect(() => {
    meStateRef.current = meState
  }, [meState])

  useEffect(() => {
    selectedPointIdRef.current = selectedPointId
  }, [selectedPointId])

  useEffect(() => {
    autoPanoramaDismissedRef.current = false
  }, [selectedPoint?.id])

  useEffect(() => {
    return () => {
      clearPanoramaProgressTimers()
    }
  }, [clearPanoramaProgressTimers])

  useEffect(() => {
    if (!selectedPointPanorama && mapViewMode === 'panorama') {
      setMapViewMode('map')
    }
  }, [mapViewMode, selectedPointPanorama])

  useEffect(() => {
    if (mapViewMode !== 'map') return
    const map = mapRef.current
    if (!map) return
    const rafId = window.requestAnimationFrame(() => map.resize())
    return () => window.cancelAnimationFrame(rafId)
  }, [mapViewMode])

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
  }, [mapViewMode, mapZoom, selectedPointPanorama])

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
    startPanoramaProgress,
  ])

  const getCameraPadding = useCallback((withDetailPanel: boolean): CameraPadding => {
    const map = mapRef.current
    const defaultTop = 56

    if (!map) {
      const sidePadding = withDetailPanel && isDesktop ? DETAIL_PANEL_WIDTH + 24 : 40
      return {
        top: defaultTop,
        right: sidePadding,
        bottom: withDetailPanel ? (isDesktop ? 120 : 220) : defaultTop,
        left: 40,
      }
    }

    const container = map.getContainer()
    const width = container.clientWidth
    const height = container.clientHeight
    const desktopViewport = width >= DESKTOP_BREAKPOINT

    if (!desktopViewport) {
      const top = Math.max(22, Math.round(height * 0.06))
      return {
        top,
        right: 22,
        left: 22,
        bottom: withDetailPanel ? Math.max(220, Math.round(height * 0.4)) : Math.max(88, Math.round(height * 0.16)),
      }
    }

    const rightPanel = withDetailPanel ? Math.min(Math.round(width * 0.42), DETAIL_PANEL_WIDTH + 24) : 28
    const top = Math.max(28, Math.round(height * 0.08))
    const bottom = withDetailPanel ? Math.max(82, Math.round(height * 0.24)) : top
    const left = Math.max(28, Math.round(width * 0.07))

    return {
      top,
      right: rightPanel,
      bottom,
      left,
    }
  }, [])

  const getCameraOffset = useCallback(
    (withDetailPanel: boolean): [number, number] => {
      const padding = getCameraPadding(withDetailPanel)
      return [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2]
    },
    [getCameraPadding]
  )

  const focusGeo = useCallback(
    (geo: [number, number], zoom: number, withDetailPanel: boolean) => {
      const map = mapRef.current
      if (!map) return false

      if (focusTimerRef.current != null) {
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = null
      }

      map.resize()
      map.stop()
      const offset = getCameraOffset(withDetailPanel)
      const targetCenter: [number, number] = [geo[1], geo[0]]
      map.flyTo({
        center: targetCenter,
        zoom,
        offset,
        essential: true,
        duration: 260,
      })

      // A second short recenter solves occasional visual drift while map canvas is still settling.
      focusTimerRef.current = window.setTimeout(() => {
        const activeMap = mapRef.current
        if (!activeMap) return
        activeMap.easeTo({
          center: targetCenter,
          zoom: Math.max(activeMap.getZoom(), zoom),
          offset,
          essential: true,
          duration: 120,
        })
        focusTimerRef.current = null
      }, 180)

      return true
    },
    [getCameraOffset]
  )

  const fitBangumiBounds = useCallback(
    (points: PointCoord[]) => {
      const map = mapRef.current
      if (!map || points.length < 2) return false

      const bounds = buildBounds(points)
      if (!bounds) return false
      const center = bounds.getCenter()

      if (focusTimerRef.current != null) {
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = null
      }

      map.resize()
      map.fitBounds(bounds, {
        padding: getCameraPadding(true),
        maxZoom: 12.8,
        duration: 280,
        essential: true,
      })
      return true
    },
    [getCameraPadding]
  )

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
  }, [])

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
  }, [ensurePointSourceAndLayers])

  useEffect(() => {
    syncPointLayerRef.current = flushPointLayer
  }, [flushPointLayer])

  const schedulePointLayerFallbackFlush = useCallback(() => {
    if (typeof window === 'undefined') return
    if (pointLayerFallbackTimerRef.current != null) return
    pointLayerFallbackTimerRef.current = window.setTimeout(() => {
      pointLayerFallbackTimerRef.current = null
      syncPointLayerRef.current()
    }, 650)
  }, [])

  const scheduleRangeOverlayFallbackFlush = useCallback(() => {
    if (typeof window === 'undefined') return
    if (rangeOverlayFallbackTimerRef.current != null) return
    rangeOverlayFallbackTimerRef.current = window.setTimeout(() => {
      rangeOverlayFallbackTimerRef.current = null
      syncRangeOverlayRef.current()
    }, 650)
  }, [])

  const refreshPendingPointGeoJson = useCallback(() => {
    pendingPointGeoJsonRef.current = detail
      ? buildPointFeatureCollection(detail, selectedPointId, meState, viewFilter, stateFilter)
      : createEmptyPointFeatureCollection()
    const ok = syncPointLayerRef.current()
    if (!ok) schedulePointLayerFallbackFlush()
  }, [detail, meState, schedulePointLayerFallbackFlush, selectedPointId, stateFilter, viewFilter])

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
  }, [schedulePointLayerFallbackFlush])

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

      // Keep range area below point circles.
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
  }, [])

  useEffect(() => {
    syncRangeOverlayRef.current = syncRangeOverlay
  }, [syncRangeOverlay])

  // ---------------------------------------------------------------------------
  // Complete Mode — show all preloaded bangumi points on the map at once
  // ---------------------------------------------------------------------------

  const flushCompleteMode = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return false

    const clearThumbImages = () => {
      const imageIds = map.listImages().filter((id) => id.startsWith('thumb-'))
      for (const imageId of imageIds) {
        if (map.hasImage(imageId)) {
          map.removeImage(imageId)
        }
      }
    }

    const clearPointImageSource = () => {
      updateCompleteModePointImageSource(map, { type: 'FeatureCollection', features: [] })
    }

    const clearThemeSource = () => {
      updateCompleteModeThemeSource(map, { type: 'FeatureCollection', features: [] })
    }

    const fc = completeFeatureCollectionRef.current
    // In simple mode, hide complete mode
    if (mapModeRef.current === 'simple') {
      removeCompleteModeLayers(map)
      removeLabelLayer(map)
      coverAvatarLoaderRef.current = null
      completePointImageLoaderRef.current = null
      completePointImageSyncTokenRef.current += 1
      clearThumbImages()
      loadedCoverIdsRef.current = new Set()
      completeCoverFeatureCollectionRef.current = null
      completeCoverCandidatesRef.current = []
      return true
    }

    if (!fc || fc.features.length === 0) {
      removeCompleteModeLayers(map)
      removeLabelLayer(map)
      coverAvatarLoaderRef.current = null
      completePointImageLoaderRef.current = null
      completePointImageSyncTokenRef.current += 1
      clearThumbImages()
      loadedCoverIdsRef.current = new Set()
      completeCoverFeatureCollectionRef.current = null
      completeCoverCandidatesRef.current = []
      return true
    }

    try {
      const currentZoom = map.getZoom()
      const detailBangumiId = detailRef.current?.card.id ?? null
      const focusedThemeMinZoom = detailBangumiId == null ? COMPLETE_DETAIL_THEME_MIN_ZOOM : 0
      const focusedImageShowZoom = detailBangumiId == null
        ? completeImageShowZoom
        : Math.max(COMPLETE_DETAIL_THEME_MIN_ZOOM + 0.2, completeImageShowZoom - 0.9)
      const focusedImageBuildZoom = detailBangumiId == null
        ? completeImageBuildZoom
        : Math.max(COMPLETE_DETAIL_THEME_MIN_ZOOM, completeImageBuildZoom - 0.9)

      ensureCompleteModeSources(map)
      ensureCompleteModeSymbolLayer(map, {
        avatarMaxZoom: COMPLETE_AVATAR_MAX_ZOOM,
        detailThemeMinZoom: focusedThemeMinZoom,
        imageShowZoom: focusedImageShowZoom,
      })
      if (map.getLayer(COMPLETE_ICONS_LAYER_ID)) {
        map.setLayerZoomRange(COMPLETE_ICONS_LAYER_ID, focusedThemeMinZoom, COMPLETE_DETAIL_THEME_MAX_ZOOM)
      }
      if (map.getLayer(COMPLETE_THEME_FALLBACK_LAYER_ID)) {
        map.setLayerZoomRange(COMPLETE_THEME_FALLBACK_LAYER_ID, focusedThemeMinZoom, COMPLETE_DETAIL_THEME_MAX_ZOOM)
      }
      if (map.getLayer(COMPLETE_POINT_IMAGES_LAYER_ID)) {
        map.setLayerZoomRange(COMPLETE_POINT_IMAGES_LAYER_ID, focusedImageShowZoom, 24)
      }
      updateCompleteModeSources(map, fc)

      const coverBase = completeCoverFeatureCollectionRef.current
      const coverCollection: GeoJSON.FeatureCollection = coverBase || { type: 'FeatureCollection', features: [] }

      updateCompleteModeCoverSource(map, coverCollection, loadedCoverIdsRef.current)

      if (coverAvatarLoaderRef.current && completeCoverCandidatesRef.current.length > 0) {
        const coverCandidates = completeCoverCandidatesRef.current
        void coverAvatarLoaderRef.current.updateViewport(coverCandidates).then((ids) => {
          loadedCoverIdsRef.current = ids
          const liveMap = mapRef.current
          if (!liveMap || !liveMap.isStyleLoaded()) return
          updateCompleteModeCoverSource(liveMap, coverCollection, ids)
          liveMap.triggerRepaint()
        }).catch(() => null)
      }

      const shouldShowCovers = detailBangumiId == null && currentZoom < COMPLETE_AVATAR_MAX_ZOOM
      const shouldShowThemeIcons = detailBangumiId != null
        && currentZoom < COMPLETE_DETAIL_THEME_MAX_ZOOM
      const shouldPopulateThemeSource = detailBangumiId != null
      const shouldBuildPointImages = detailBangumiId != null && currentZoom >= focusedImageBuildZoom
      const shouldShowPointImages = shouldBuildPointImages && currentZoom >= focusedImageShowZoom

      if (!shouldPopulateThemeSource) {
        clearThemeSource()
      } else {
        const themeFeatures = fc.features.filter((feature) => {
          const props = feature.properties as { bangumiId?: unknown } | undefined
          const bangumiId = Number.parseInt(String(props?.bangumiId ?? ''), 10)
          return Number.isFinite(bangumiId) && bangumiId === detailBangumiId
        })
        updateCompleteModeThemeSource(map, {
          type: 'FeatureCollection',
          features: themeFeatures,
        })
      }

      updateCompleteModeLayerVisibility(map, {
        showCovers: shouldShowCovers,
        showThemeIcons: shouldShowThemeIcons,
        showPointImages: shouldShowPointImages,
      })

      if (!shouldBuildPointImages) {
        completePointImageSyncTokenRef.current += 1
        clearPointImageSource()
        if (detailBangumiId == null) {
          clearThumbImages()
        }
      } else {
        if (!completePointImageLoaderRef.current) {
          completePointImageLoaderRef.current = new ThumbnailLoader({
            map,
            maxLoaded: isDesktopRef.current ? 140 : 80,
          })
        }

        const featurePool = fc.features.filter((feature) => {
          const props = feature.properties as { bangumiId?: unknown } | undefined
          const bangumiId = Number.parseInt(String(props?.bangumiId ?? ''), 10)
          return Number.isFinite(bangumiId) && bangumiId === detailBangumiId
        })

        const pointById = new Map<string, GeoJSON.Feature<GeoJSON.Point>>()
        for (const feature of featurePool) {
          const props = feature.properties as { pointId?: unknown; bangumiId?: unknown } | undefined
          const pointId = String(props?.pointId ?? '')
          if (!pointId) continue
          const bangumiId = Number.parseInt(String(props?.bangumiId ?? ''), 10)
          if (!Number.isFinite(bangumiId)) continue
          pointById.set(`${bangumiId}:${pointId}`, feature as GeoJSON.Feature<GeoJSON.Point>)
        }

        const rendered = map.getLayer(COMPLETE_DOTS_LAYER_ID)
          ? map.queryRenderedFeatures({ layers: [COMPLETE_DOTS_LAYER_ID] })
          : []

        const candidateByPointId = new Map<
          string,
          {
            thumbnailKey: string;
            pointId: string;
            bangumiId: number;
            color: string;
            imageUrl: string | null;
            priority: number;
            density: number | null;
            geometry: [number, number];
          }
        >()

        for (const hit of rendered) {
          const hitProps = hit.properties as { pointId?: unknown; bangumiId?: unknown } | undefined
          const rawPointId = String(hitProps?.pointId ?? '')
          const hitBangumiId = Number.parseInt(String(hitProps?.bangumiId ?? ''), 10)
          if (!rawPointId || !Number.isFinite(hitBangumiId)) continue
          if (detailBangumiId != null && hitBangumiId !== detailBangumiId) continue
          const pointKey = `${hitBangumiId}:${rawPointId}`
          if (candidateByPointId.has(pointKey)) continue
          const sourceFeature = pointById.get(pointKey)
          if (!sourceFeature) continue
          const props = sourceFeature.properties as {
            pointId?: unknown;
            bangumiId?: unknown;
            color?: unknown;
            imageUrl?: unknown;
            priority?: unknown;
            density?: unknown;
          }
          const imageUrl = typeof props.imageUrl === 'string' ? props.imageUrl : null
          if (!imageUrl) continue
          const priority = typeof props.priority === 'number' && Number.isFinite(props.priority) ? props.priority : 0
          const bangumiId = Number.parseInt(String(props.bangumiId ?? ''), 10)
          if (!Number.isFinite(bangumiId)) continue
          const color = typeof props.color === 'string' ? props.color : '#333'
          const coords = sourceFeature.geometry?.coordinates
          if (!Array.isArray(coords) || coords.length < 2) continue
          const geometry: [number, number] = [Number(coords[0]), Number(coords[1])]
          if (!Number.isFinite(geometry[0]) || !Number.isFinite(geometry[1])) continue
          const density = typeof props.density === 'number' && Number.isFinite(props.density) ? props.density : null
          candidateByPointId.set(pointKey, {
            thumbnailKey: pointKey,
            pointId: rawPointId,
            bangumiId,
            color,
            imageUrl,
            priority,
            density,
            geometry,
          })
        }

        const maxCandidates = isDesktopRef.current ? 120 : 72
        const candidates = Array.from(candidateByPointId.values())
          .sort((a, b) => b.priority - a.priority)
          .slice(0, maxCandidates)

        if (candidates.length === 0) {
          completePointImageSyncTokenRef.current += 1
          clearPointImageSource()
        } else {
          const loaderInput: GlobalPointFeatureProperties[] = candidates.map((candidate) => ({
            pointId: candidate.thumbnailKey,
            color: candidate.color,
            selected: 0,
            userState: 'none',
            bangumiId: candidate.bangumiId,
            imageUrl: candidate.imageUrl,
            priority: candidate.priority,
            density: candidate.density,
          }))
          const token = completePointImageSyncTokenRef.current + 1
          completePointImageSyncTokenRef.current = token

          void completePointImageLoaderRef.current.updateViewport(loaderInput).then((loadedIds) => {
            if (completePointImageSyncTokenRef.current !== token) return
            const liveMap = mapRef.current
            if (!liveMap || !liveMap.isStyleLoaded()) return

            const imageFeatures: GeoJSON.Feature<GeoJSON.Point>[] = candidates
              .filter((candidate) => loadedIds.has(`thumb-${candidate.thumbnailKey}`))
              .map((candidate) => ({
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: candidate.geometry,
                },
                properties: {
                  pointId: candidate.pointId,
                  bangumiId: candidate.bangumiId,
                  image: `thumb-${candidate.thumbnailKey}`,
                  y: candidate.geometry[1] * -1,
                  priority: candidate.priority,
                  density: candidate.density,
                },
              }))

            updateCompleteModePointImageSource(liveMap, {
              type: 'FeatureCollection',
              features: imageFeatures,
            })
            updateCompleteModeLayerVisibility(liveMap, {
              showCovers: shouldShowCovers,
              showThemeIcons: shouldShowThemeIcons,
              showPointImages: shouldShowPointImages,
            })
            liveMap.triggerRepaint()
          }).catch(() => null)
        }
      }

      // Re-register sprite images if they were lost during a style change
      // (MapLibre removes all images on setStyle)
      for (const imageId of spriteImageIdsRef.current) {
        if (!map.hasImage(imageId)) {
          // Images were lost — a re-init is needed.
          // The data-init useEffect will re-run when detail toggles.
          break
        }
      }

      map.triggerRepaint()
      return true
    } catch {
      return false
    }
  }, [completeImageBuildZoom, completeImageShowZoom])

  useEffect(() => {
    syncCompleteModeRef.current = flushCompleteMode
  }, [flushCompleteMode])

  useEffect(() => {
    if (mapMode !== 'complete' || !mapReady) return
    if (!detail?.card.id || !completeFeatureCollectionRef.current) return

    const timer = window.setTimeout(() => {
      syncCompleteModeRef.current()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    detail?.card.id,
    mapMode,
    mapReady,
    selectedPointId,
    warmupTaskProgress.cards.percent,
    warmupTaskProgress.details.percent,
    warmupTaskProgress.map.percent,
  ])

  useEffect(() => { mapModeRef.current = mapMode }, [mapMode])

  // Complete Mode useEffect 1 — Global data init + sprite cutting
  useEffect(() => {
    // In simple mode, clear complete mode layers
    if (mapMode === 'simple') {
      completeFeatureCollectionRef.current = null
      completeCoverFeatureCollectionRef.current = null
      completeCoverCandidatesRef.current = []
      loadedCoverIdsRef.current = new Set()
      coverAvatarLoaderRef.current = null
      setCompleteModeLoading(false)
      const map = mapRef.current
      if (map && map.isStyleLoaded()) {
        removeCompleteModeLayers(map)
        removeLabelLayer(map)
      }
      return
    }

    // In complete mode with detail selected, re-flush to filter
    if (detail && completeFeatureCollectionRef.current) {
      syncCompleteModeRef.current()
      return
    }

    // In complete mode with detail just deselected, re-flush to show all
    if (!detail && completeFeatureCollectionRef.current) {
      syncCompleteModeRef.current()
      return
    }

    // Render points as soon as map/cards/details are ready; image preheat may continue in background.
    const warmupCoreReady = warmupTaskProgress.map.percent >= 100
      && warmupTaskProgress.cards.percent >= 100
      && warmupTaskProgress.details.percent >= 100
    if (!warmupCoreReady) return

    // Don't re-initialize if feature collection already exists
    if (completeFeatureCollectionRef.current) return

    // Abort any in-flight previous operation
    completeAbortRef.current?.abort()
    const controller = new AbortController()
    completeAbortRef.current = controller

    const run = async () => {
      const map = mapRef.current
      if (!map) return

      // Collect all points from all preloaded bangumi
      const allInputPoints: InputPoint[] = []
      const bangumiDataList: Array<{
        bangumiId: number
        color: string
        theme: unknown | null
        points: Array<{ id: string; geo: [number, number] }>
      }> = []

      // Get all cards from all tabs for color info
      const allCards = new Map<number, AnitabiBangumiCard>()
      for (const rows of Object.values(tabCardsRef.current)) {
        if (!rows) continue
        for (const card of rows) {
          allCards.set(card.id, card)
        }
      }

      const coverCandidates = Array.from(allCards.values())
        .filter((card) => Boolean(card.cover) && Boolean(card.geo) && isValidGeoPair(card.geo!))
        .sort((a, b) => {
          const pointDelta = (b.pointsLength || 0) - (a.pointsLength || 0)
          if (pointDelta !== 0) return pointDelta
          const imageDelta = (b.imagesLength || 0) - (a.imagesLength || 0)
          if (imageDelta !== 0) return imageDelta
          return (b.sourceModifiedMs || 0) - (a.sourceModifiedMs || 0)
        })
        .slice(0, COMPLETE_MODE_COVER_CANDIDATES_MAX)
        .map((card) => ({
          bangumiId: card.id,
          coverUrl: card.cover as string,
        }))

      const coverFeatures: GeoJSON.Feature[] = []
      for (const item of coverCandidates) {
        const card = allCards.get(item.bangumiId)
        if (!card?.geo || !isValidGeoPair(card.geo)) continue
        const [lat, lng] = card.geo
        coverFeatures.push({
          type: 'Feature',
          properties: {
            bangumiId: item.bangumiId,
          },
          geometry: {
            type: 'Point',
            coordinates: [lng, lat],
          },
        })
      }
      completeCoverCandidatesRef.current = coverCandidates
      completeCoverFeatureCollectionRef.current = {
        type: 'FeatureCollection',
        features: coverFeatures,
      }
      loadedCoverIdsRef.current = new Set()
      if (!coverAvatarLoaderRef.current) {
        coverAvatarLoaderRef.current = new CoverAvatarLoader({ map, maxLoaded: COMPLETE_MODE_COVER_MAX_LOADED })
      }

      // Build input points from warmup data
      for (const [bangumiId, chunk] of warmPointIndexByBangumiIdRef.current.entries()) {
        if (controller.signal.aborted) return
        const card = allCards.get(bangumiId)
        const color = card?.color || '#333'

        const validPoints: Array<{ id: string; geo: [number, number] }> = []
        for (const point of chunk.points) {
          if (!point.geo || !isValidGeoPair(point.geo)) continue
          validPoints.push({ id: point.id, geo: point.geo })
          allInputPoints.push({
            lat: point.geo[0],
            lng: point.geo[1],
            bangumiId: String(bangumiId),
            color,
            pointId: point.id,
            imageUrl: point.image ?? null,
            density: point.density ?? null,
          })
        }

        if (validPoints.length > 0) {
          bangumiDataList.push({
            bangumiId,
            color,
            theme: chunk.theme,
            points: validPoints,
          })
        }
      }

      if (controller.signal.aborted) return
      if (allInputPoints.length === 0) return

      // Build global feature collection with priority
      const fc = createGlobalFeatureCollection(allInputPoints)

      // Store the feature collection and flush to map immediately
      // This ensures dots appear even if sprite cutting is aborted
      completeFeatureCollectionRef.current = fc
      syncCompleteModeRef.current()
      if (controller.signal.aborted) return

      if (coverAvatarLoaderRef.current && coverCandidates.length > 0) {
        void coverAvatarLoaderRef.current.updateViewport(coverCandidates).then((ids) => {
          if (controller.signal.aborted) return
          loadedCoverIdsRef.current = ids
          const liveMap = mapRef.current
          const coverFc = completeCoverFeatureCollectionRef.current
          if (!liveMap || !liveMap.isStyleLoaded() || !coverFc) return
          updateCompleteModeCoverSource(liveMap, coverFc, ids)
          liveMap.triggerRepaint()
        }).catch(() => null)
      }

      // Create an image loader that uses our CORS proxy
      const imageLoader: ImageLoader = (url: string) => {
        return new Promise<HTMLImageElement>((resolve, reject) => {
          if (controller.signal.aborted) {
            reject(new Error('Aborted'))
            return
          }
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error(`Failed to load: ${url}`))
          // Resolve relative paths (e.g. /images/ptheme/...) against anitabi.cn
          // so toCanvasSafeImageUrl routes them through the CORS proxy
          const absoluteUrl = url.startsWith('/') ? `https://www.anitabi.cn${url}` : url
          img.src = toCanvasSafeImageUrl(absoluteUrl)

          controller.signal.addEventListener('abort', () => {
            img.src = ''
            reject(new Error('Aborted'))
          }, { once: true })
        })
      }

      // Cut sprites for each bangumi with a valid theme
      const newSpriteIds = new Set<string>()
      const spriteCandidates = bangumiDataList
        .filter((bangumi) => isValidTheme(bangumi.theme))
        .sort((a, b) => b.points.length - a.points.length)
        .slice(0, COMPLETE_MODE_SPRITE_MAX_BANGUMI)
      const spriteDeadline = performance.now() + COMPLETE_MODE_SPRITE_BUDGET_MS
      warmupMetricRef.current.complete_sprite_cut_total = spriteCandidates.length
      warmupMetricRef.current.complete_sprite_cut_done = 0
      warmupMetricRef.current.complete_sprite_cut_budget_hit = 0

      for (let idx = 0; idx < spriteCandidates.length; idx += 1) {
        const bangumi = spriteCandidates[idx]!
        if (controller.signal.aborted) return

        if (performance.now() > spriteDeadline) {
          warmupMetricRef.current.complete_sprite_cut_budget_hit = 1
          break
        }

        try {
          const sprites = await cutSpriteSheet(
            bangumi.bangumiId,
            bangumi.theme as AnitabiTheme,
            bangumi.points.map((p) => ({ id: p.id })),
            bangumi.color,
            imageLoader,
          )
          if (controller.signal.aborted) return

          // Add sprite images to the map and set icon on features
          for (const [imageId, sprite] of sprites.entries()) {
            if (controller.signal.aborted) return
            if (!map.hasImage(imageId)) {
              map.addImage(imageId, sprite.imageData, { pixelRatio: 2 })
            }
            newSpriteIds.add(imageId)
          }

          // Set icon property on matching features
          for (const feature of fc.features) {
            const spriteKey = `sprite-${bangumi.bangumiId}-${feature.properties.pointId}`
            if (sprites.has(spriteKey)) {
              feature.properties.icon = spriteKey
            }
          }
        } catch {
          // Sprite loading failed for this bangumi — features will use dot fallback
        }
        warmupMetricRef.current.complete_sprite_cut_done = idx + 1
        if ((idx + 1) % 2 === 0) {
          await yieldToMainThread(controller.signal)
        }
      }

      if (controller.signal.aborted) return

      // Track sprite image IDs for cleanup
      spriteImageIdsRef.current = newSpriteIds

      // Store the feature collection and flush to map
      // Update feature collection again with sprite icons
      syncCompleteModeRef.current()

      // Set up label layer for bangumi names
      const labelPoints: Array<{ lng: number; lat: number; text: string }> = []
      for (const [bangumiId] of warmPointIndexByBangumiIdRef.current.entries()) {
        const card = allCards.get(bangumiId)
        if (!card) continue
        const chunk = warmPointIndexByBangumiIdRef.current.get(bangumiId)
        if (!chunk) continue
        const firstValid = chunk.points.find((p) => p.geo && isValidGeoPair(p.geo))
        if (firstValid?.geo) {
          labelPoints.push({
            lng: firstValid.geo[1],
            lat: firstValid.geo[0],
            text: card.titleZh || card.title,
          })
        }
      }

      if (controller.signal.aborted) return
      if (labelPoints.length > 0 && map.isStyleLoaded()) {
        ensureLabelLayer(map)
        updateLabelSource(map, buildLabelFeatureCollection(labelPoints))
      }
    }
    setCompleteModeLoading(true)
    run().catch(() => {
      // Silently handle errors — complete mode is optional enhancement
    }).finally(() => {
      setCompleteModeLoading(false)
    })

    return () => {
      controller.abort()
    }
  }, [
    detail,
    mapMode,
    warmupTaskProgress.cards.percent,
    warmupTaskProgress.details.percent,
    warmupTaskProgress.map.percent,
  ])

  // Keep complete-mode open callback in a ref for map click handlers.
  const openBangumiRef = useRef<((id: number, pointId?: string | null) => Promise<void>) | null>(null)

  // Complete Mode useEffect 3 — Cleanup on unmount
  useEffect(() => () => {
    completeAbortRef.current?.abort()
    completeAbortRef.current = null

    const map = mapRef.current
    if (map && map.isStyleLoaded()) {
      const thumbImageIds = map.listImages().filter((id) => id.startsWith('thumb-'))
      for (const imageId of thumbImageIds) {
        if (map.hasImage(imageId)) {
          map.removeImage(imageId)
        }
      }
      for (const imageId of spriteImageIdsRef.current) {
        if (map.hasImage(imageId)) {
          map.removeImage(imageId)
        }
      }
      removeCompleteModeLayers(map)
      removeLabelLayer(map)
    }
    spriteImageIdsRef.current.clear()
    completeFeatureCollectionRef.current = null
    coverAvatarLoaderRef.current = null
    completePointImageLoaderRef.current = null
    completePointImageSyncTokenRef.current += 1
    loadedCoverIdsRef.current = new Set()
    completeCoverFeatureCollectionRef.current = null
    completeCoverCandidatesRef.current = []
    setCompleteModeLoading(false)
  }, [])

  useEffect(() => () => {
    if (pointLayerFallbackTimerRef.current != null) {
      window.clearTimeout(pointLayerFallbackTimerRef.current)
      pointLayerFallbackTimerRef.current = null
    }
    if (rangeOverlayFallbackTimerRef.current != null) {
      window.clearTimeout(rangeOverlayFallbackTimerRef.current)
      rangeOverlayFallbackTimerRef.current = null
    }
  }, [])

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
  }, [query, selectedBangumiId, selectedPointId, tab])

  useEffect(() => {
    syncUrlRef.current = syncUrl
  }, [syncUrl])

  useEffect(() => {
    detailRef.current = detail
  }, [detail])

  const loadMe = useCallback(async () => {
    try {
      const pointRes = await fetch('/api/me/point-states', { method: 'GET' })
      if (pointRes.status === 401) {
        setMeState(null)
        return
      }

      if (!pointRes.ok) return
      const pointJson = await pointRes.json().catch(() => ({ items: [] }))

      setMeState({
        pointStates: Array.isArray(pointJson.items) ? pointJson.items : [],
      })
    } catch {
      // noop
    }
  }, [])

  const loadBootstrap = useCallback(async () => {
    const requestToken = cardFeedTokenRef.current + 1
    cardFeedTokenRef.current = requestToken
    setLoading(true)
    setCards([])
    setLoadingMoreCards(false)
    setCardsLoadError(null)
    try {
      const store = cacheStoreRef.current
      const canUseTabCache = tab !== 'nearby' && !query && !selectedCity
      if (canUseTabCache && store) {
        const cached = await store.getCards(tab).catch(() => null)
        if (cached && Array.isArray(cached.cards)) {
          if (requestToken !== cardFeedTokenRef.current) return
          setCards(cached.cards)
          tabCardsRef.current[tab] = cached.cards
          loadedTabsRef.current.add(tab)
          setTabCardsVersion((prev) => prev + 1)
          setNextChunkIndex(1)
          setHasMoreCards(false)
          return
        }
      }

      const params = new URLSearchParams()
      params.set('locale', locale)
      params.set('tab', tab)
      if (query) params.set('q', query)
      if (selectedCity) params.set('city', selectedCity)
      if (tab === 'nearby' && userLocation) {
        params.set('ulat', userLocation.lat.toFixed(6))
        params.set('ulng', userLocation.lng.toFixed(6))
      }

      const res = await fetch(`/api/anitabi/bootstrap?${params.toString()}`, { method: 'GET' })
      if (!res.ok) throw new Error('Failed to load bootstrap')
      const json = (await res.json()) as AnitabiBootstrapDTO
      if (requestToken !== cardFeedTokenRef.current) return
      setBootstrap(json)
      setCards(json.cards)
      tabCardsRef.current[tab] = json.cards
      loadedTabsRef.current.add(tab)
      setTabCardsVersion((prev) => prev + 1)
      setNextChunkIndex(1)
      setHasMoreCards(json.cards.length >= CARD_PAGE_SIZE)
      if (store && tab !== 'nearby' && !query && !selectedCity) {
        await store.putCards(tab, {
          datasetVersion: json.datasetVersion,
          tab,
          cards: json.cards,
          cachedAt: Date.now(),
        }).catch(() => null)
      }
    } finally {
      if (requestToken !== cardFeedTokenRef.current) return
      setLoading(false)
    }
  }, [locale, query, selectedCity, tab, userLocation])

  const updateWarmupProgress = useCallback((next: Partial<WarmupProgress>, options?: { runToken?: number }) => {
    const runToken = options?.runToken
    if (runToken != null && runToken !== warmupRunTokenRef.current) return
    setWarmupProgress((prev) => ({
      phase: next.phase || prev.phase,
      percent: Math.max(0, Math.min(100, next.percent ?? prev.percent)),
      title: next.title || label.preloadTitle,
      detail: next.detail ?? prev.detail,
    }))
  }, [label.preloadTitle])

  const computeWarmupPercent = useCallback((tasks: WarmupTaskProgress): number => {
    let weightedSum = 0
    let totalWeight = 0
    let allDone = true
    for (const key of Object.keys(tasks) as WarmupTaskKey[]) {
      const weight = WARMUP_TASK_WEIGHTS[key]
      const taskPercent = Math.max(0, Math.min(100, tasks[key].percent))
      if (taskPercent < 100) allDone = false
      weightedSum += taskPercent * weight
      totalWeight += weight
    }
    if (!totalWeight) return 0
    const raw = weightedSum / totalWeight
    if (allDone) return 100
    return Math.max(0, Math.min(99, Math.floor(raw)))
  }, [])

  const resetWarmupTaskProgress = useCallback(() => {
    setWarmupTaskProgress(createEmptyWarmupTaskProgress())
  }, [])

  const updateWarmupTask = useCallback((
    key: WarmupTaskKey,
    next: { percent?: number; detail?: string },
    options?: { runToken?: number },
  ) => {
    const runToken = options?.runToken
    if (runToken != null && runToken !== warmupRunTokenRef.current) return
    setWarmupTaskProgress((prev) => {
      const current = prev[key]
      const incomingPercent = Math.max(0, Math.min(100, next.percent ?? current.percent))
      const nextPercent = incomingPercent < current.percent ? current.percent : incomingPercent
      if (incomingPercent < current.percent) {
        const blocked = Number(warmupMetricRef.current.progress_regression_blocked || 0)
        warmupMetricRef.current.progress_regression_blocked = blocked + 1
      }
      const merged: WarmupTaskProgress = {
        ...prev,
        [key]: {
          percent: nextPercent,
          detail: incomingPercent < current.percent ? current.detail : (next.detail ?? current.detail),
        },
      }
      const combinedPercent = computeWarmupPercent(merged)
      warmupMetricRef.current.last_progress_at = Date.now()
      warmupMetricRef.current.last_progress_key = key
      warmupMetricRef.current.last_progress_percent = combinedPercent
      warmupMetricRef.current.last_progress_detail = next.detail ?? current.detail
      setWarmupProgress((prevWarmup) => ({
        phase: prevWarmup.phase === 'idle' && warmupBlockingUiRef.current && combinedPercent < 100
          ? 'loading'
          : prevWarmup.phase,
        percent: combinedPercent,
        title: label.preloadTitle,
        detail: next.detail ?? prevWarmup.detail,
      }))
      return merged
    })
  }, [computeWarmupPercent, label.preloadTitle])

  const completeAllWarmupTasks = useCallback((options?: { runToken?: number }) => {
    const runToken = options?.runToken
    if (runToken != null && runToken !== warmupRunTokenRef.current) return
    setWarmupTaskProgress((prev) => ({
      map: { percent: 100, detail: prev.map.detail || label.preloadMapDone },
      cards: { percent: 100, detail: prev.cards.detail },
      details: { percent: 100, detail: prev.details.detail },
      images: { percent: 100, detail: prev.images.detail },
    }))
  }, [label.preloadMapDone])

  const waitForMapInstance = useCallback((signal?: AbortSignal): Promise<maplibregl.Map | null> => {
    if (mapRef.current) return Promise.resolve(mapRef.current)
    if (signal?.aborted || typeof window === 'undefined') return Promise.resolve(null)

    return new Promise((resolve) => {
      const onReady = () => {
        cleanup()
        resolve(mapRef.current)
      }
      const cleanup = () => {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }
        const idx = mapInitWaitersRef.current.indexOf(onReady)
        if (idx >= 0) mapInitWaitersRef.current.splice(idx, 1)
        if (signal) signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        resolve(null)
      }

      let timeoutId: number | null = window.setTimeout(() => {
        cleanup()
        resolve(mapRef.current)
      }, WARMUP_MAP_WAIT_TIMEOUT_MS)

      mapInitWaitersRef.current.push(onReady)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
    })
  }, [])

  const preloadMapBaseLayer = useCallback(async (signal?: AbortSignal, runToken?: number) => {
    updateWarmupTask('map', { percent: 2, detail: label.preloadMapPreparing }, { runToken })
    const map = await waitForMapInstance(signal)
    if (!map || signal?.aborted) return

    await new Promise<void>((resolve) => {
      let finished = false
      const cleanup = () => {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }
        map.off('styledata', onStyleData)
        map.off('load', onLoadOrIdle)
        map.off('idle', onIdle)
        if (signal) signal.removeEventListener('abort', onAbort)
      }

      const finish = (percent = 100, detail = label.preloadMapDone) => {
        if (finished) return
        finished = true
        updateWarmupTask('map', { percent, detail }, { runToken })
        cleanup()
        resolve()
      }

      const onStyleData = () => {
        updateWarmupTask('map', { percent: 45, detail: label.preloadMapPreparing }, { runToken })
      }
      const onLoadOrIdle = () => {
        updateWarmupTask('map', { percent: 78, detail: label.preloadMapTiles }, { runToken })
      }
      const onIdle = () => {
        finish(100, label.preloadMapDone)
      }
      const onAbort = () => {
        finish(100, label.preloadMapDone)
      }

      let timeoutId: number | null = window.setTimeout(() => {
        finish(100, label.preloadMapDone)
      }, WARMUP_MAP_READY_TIMEOUT_MS)

      map.on('styledata', onStyleData)
      map.on('load', onLoadOrIdle)
      map.on('idle', onIdle)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })

      if (map.isStyleLoaded()) onStyleData()
      try {
        if (map.areTilesLoaded()) {
          finish(100, label.preloadMapDone)
          return
        }
      } catch {
        // noop
      }
    })
  }, [
    label.preloadMapDone,
    label.preloadMapPreparing,
    label.preloadMapTiles,
    updateWarmupTask,
    waitForMapInstance,
  ])

  const fetchPreloadManifest = useCallback(async (signal?: AbortSignal): Promise<AnitabiPreloadManifestDTO | null> => {
    const store = cacheStoreRef.current
    if (!store) return null

    const cached = await withPromiseTimeout(
      store.getPreloadManifest().catch(() => null),
      3500,
      null,
      signal,
    )
    const fallback = cached?.manifest || null
    if (fallback) preloadManifestRef.current = fallback

    try {
      const { signal: requestSignal, cleanup } = createRequestSignalWithTimeout(signal, WARMUP_PRELOAD_FETCH_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(`/api/anitabi/preload/manifest?locale=${encodeURIComponent(locale)}`, {
          method: 'GET',
          signal: requestSignal,
        })
      } finally {
        cleanup()
      }
      if (!res.ok) throw new Error('load preload manifest failed')
      const manifest = (await res.json()) as AnitabiPreloadManifestDTO
      preloadManifestRef.current = manifest
      await store.putPreloadManifest({
        datasetVersion: manifest.datasetVersion,
        manifest,
        cachedAt: Date.now(),
      }).catch(() => null)
      return manifest
    } catch {
      return fallback
    }
  }, [locale])

  const fetchPreloadChunkByIndex = useCallback(async (
    manifest: AnitabiPreloadManifestDTO,
    index: number,
    signal?: AbortSignal,
  ): Promise<AnitabiPreloadChunkItemDTO[]> => {
    const store = cacheStoreRef.current
    if (!store) return []

    const cached = await withPromiseTimeout(
      store.getPreloadChunk(index).catch(() => null),
      3500,
      null,
      signal,
    )
    if (cached && cached.datasetVersion === manifest.datasetVersion && Array.isArray(cached.chunk.items)) {
      return cached.chunk.items
    }

    const { signal: requestSignal, cleanup } = createRequestSignalWithTimeout(signal, WARMUP_PRELOAD_FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(
        `/api/anitabi/preload/chunks/${index}?locale=${encodeURIComponent(locale)}`,
        { method: 'GET', signal: requestSignal },
      )
    } finally {
      cleanup()
    }
    if (!res.ok) throw new Error(`load preload chunk failed: ${index}`)
    const chunk = (await res.json()) as {
      datasetVersion: string
      index: number
      items?: AnitabiPreloadChunkItemDTO[]
    }
    if (chunk.datasetVersion && chunk.datasetVersion !== manifest.datasetVersion) {
      return []
    }
    const safeItems = Array.isArray(chunk.items) ? chunk.items : []
    await store.putPreloadChunk(index, {
      datasetVersion: manifest.datasetVersion,
      index,
      chunk: {
        datasetVersion: manifest.datasetVersion,
        index,
        items: safeItems,
      },
      cachedAt: Date.now(),
    }).catch(() => null)
    return safeItems
  }, [locale])

  const hydrateTabCardsFromManifest = useCallback((manifest: AnitabiPreloadManifestDTO) => {
    preloadManifestRef.current = manifest
    tabCardsRef.current.nearby = Array.isArray(manifest.tabs.nearby) ? manifest.tabs.nearby : []
    tabCardsRef.current.latest = Array.isArray(manifest.tabs.latest) ? manifest.tabs.latest : []
    tabCardsRef.current.recent = Array.isArray(manifest.tabs.recent) ? manifest.tabs.recent : []
    tabCardsRef.current.hot = Array.isArray(manifest.tabs.hot) ? manifest.tabs.hot : []
    loadedTabsRef.current.add('nearby')
    loadedTabsRef.current.add('latest')
    loadedTabsRef.current.add('recent')
    loadedTabsRef.current.add('hot')
    setBootstrap((prev) => (prev ? { ...prev, datasetVersion: manifest.datasetVersion } : prev))
    setTabCardsVersion((prev) => prev + 1)

    const store = cacheStoreRef.current
    if (store) {
      const cachedAt = Date.now()
      const tabsToPersist: Array<{ tab: AnitabiMapTab; cards: AnitabiBangumiCard[] }> = [
        { tab: 'nearby', cards: tabCardsRef.current.nearby || [] },
        { tab: 'latest', cards: tabCardsRef.current.latest || [] },
        { tab: 'recent', cards: tabCardsRef.current.recent || [] },
        { tab: 'hot', cards: tabCardsRef.current.hot || [] },
      ]
      void Promise.all(
        tabsToPersist.map(({ tab, cards }) =>
          store.putCards(tab, {
            datasetVersion: manifest.datasetVersion,
            tab,
            cards,
            cachedAt,
          }).catch(() => null)
        )
      )
    }
  }, [])

  const hydrateTabCardsFromCache = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    const store = cacheStoreRef.current
    if (!store || signal?.aborted) return false

    let hydrated = false
    const cachedManifest = await store.getPreloadManifest().catch(() => null)
    if (signal?.aborted) return false
    if (cachedManifest?.manifest) {
      preloadManifestRef.current = cachedManifest.manifest
      const manifestTabs = cachedManifest.manifest.tabs
      tabCardsRef.current.nearby = Array.isArray(manifestTabs.nearby) ? manifestTabs.nearby : []
      tabCardsRef.current.latest = Array.isArray(manifestTabs.latest) ? manifestTabs.latest : []
      tabCardsRef.current.recent = Array.isArray(manifestTabs.recent) ? manifestTabs.recent : []
      tabCardsRef.current.hot = Array.isArray(manifestTabs.hot) ? manifestTabs.hot : []
      loadedTabsRef.current.add('nearby')
      loadedTabsRef.current.add('latest')
      loadedTabsRef.current.add('recent')
      loadedTabsRef.current.add('hot')
      hydrated = true
    }

    const tabs: AnitabiMapTab[] = ['nearby', 'latest', 'recent', 'hot']
    const cachedTabs = await Promise.all(
      tabs.map((tabKey) => store.getCards(tabKey).catch(() => null))
    )
    if (signal?.aborted) return hydrated
    for (let idx = 0; idx < tabs.length; idx += 1) {
      const tabKey = tabs[idx]!
      const payload = cachedTabs[idx]
      if (!payload || !Array.isArray(payload.cards)) continue
      tabCardsRef.current[tabKey] = payload.cards
      loadedTabsRef.current.add(tabKey)
      hydrated = true
    }

    if (hydrated) {
      setTabCardsVersion((prev) => prev + 1)
      setLoading(false)
    }
    return hydrated
  }, [])

  const warmupAllTabsData = useCallback(async (options?: {
    signal?: AbortSignal
    background?: boolean
  }) => {
    const signal = options?.signal
    const background = Boolean(options?.background)
    const store = cacheStoreRef.current
    if (!store || signal?.aborted) return
    const runToken = warmupRunTokenRef.current + 1
    warmupRunTokenRef.current = runToken
    const isActiveRun = () => warmupRunTokenRef.current === runToken
    const updateProgressSafe = (next: Partial<WarmupProgress>) => {
      updateWarmupProgress(next, { runToken })
    }
    const updateTaskSafe = (key: WarmupTaskKey, next: { percent?: number; detail?: string }) => {
      updateWarmupTask(key, next, { runToken })
    }
    const completeTasksSafe = () => {
      completeAllWarmupTasks({ runToken })
    }

    const startedAt = performance.now()
    warmupBlockingUiRef.current = !background
    setWarmupUiBlocking(!background)
    setCardsLoadError(null)
    warmupMetricRef.current.warmup_run_token = runToken
    warmupMetricRef.current.warmup_session_started_at = Date.now()
    warmupMetricRef.current.warmup_session_background = background ? 1 : 0
    warmupMetricRef.current.last_progress_at = Date.now()
    warmupMetricRef.current.last_progress_key = 'map'
    warmupMetricRef.current.last_progress_percent = 0
    warmupMetricRef.current.last_progress_detail = label.preloadMapPreparing
    warmupMetricRef.current.promise_map_state = 0
    warmupMetricRef.current.promise_manifest_state = 0
    warmupMetricRef.current.promise_details_state = 0
    warmupMetricRef.current.promise_images_state = 0
    warmupMetricRef.current.details_chunk_done = 0
    warmupMetricRef.current.details_chunk_total = 0
    warmupMetricRef.current.details_points_loaded = 0
    warmupMetricRef.current.images_inflight = 0
    warmupMetricRef.current.images_last_src = ''
    warmupMetricRef.current.images_done = 0
    warmupMetricRef.current.images_total = 0
    warmupMetricRef.current.images_queue_remaining = 0
    warmupMetricRef.current.images_blocking_truncated = 0
    resetWarmupTaskProgress()
    updateProgressSafe({ phase: 'loading', percent: 0, detail: label.preloadMapPreparing })
    updateTaskSafe('cards', { percent: 0, detail: `${label.preloadCards} (0/0)` })
    updateTaskSafe('details', { percent: 0, detail: `${label.preloadDetails} (0/0)` })
    updateTaskSafe('images', { percent: 0, detail: `${label.preloadImages} (0/0)` })
    if (signal?.aborted || !isActiveRun()) return

    const mapStartedAt = performance.now()
    warmupMetricRef.current.promise_map_state = 1
    const mapWarmupPromise = preloadMapBaseLayer(signal, runToken)
      .then(() => {
        warmupMetricRef.current.promise_map_state = 2
      })
      .catch((error) => {
        warmupMetricRef.current.promise_map_state = -1
        throw error
      })
      .finally(() => {
        warmupMetricRef.current.map_ms = Math.round(performance.now() - mapStartedAt)
      })

    warmupMetricRef.current.promise_manifest_state = 1
    const manifestPromise = (async (): Promise<AnitabiPreloadManifestDTO> => {
      const manifestStartedAt = performance.now()
      const manifest = await fetchPreloadManifest(signal)
      if (signal?.aborted || !isActiveRun()) throw new Error('aborted')
      if (!manifest) throw new Error('preload manifest unavailable')
      warmupMetricRef.current.manifest_ms = Math.round(performance.now() - manifestStartedAt)
      updateTaskSafe('cards', { percent: 25, detail: `${label.preloadCards} (1/4)` })
      hydrateTabCardsFromManifest(manifest)
      updateTaskSafe('cards', { percent: 100, detail: `${label.preloadCards} (4/4)` })
      setLoading(false)
      return manifest
    })()
      .then((manifest) => {
        warmupMetricRef.current.promise_manifest_state = 2
        return manifest
      })
      .catch((error) => {
        warmupMetricRef.current.promise_manifest_state = -1
        throw error
      })

    warmupMetricRef.current.promise_details_state = 1
    const detailsWarmupPromise = (async () => {
      const manifest = await manifestPromise
      if (signal?.aborted || !isActiveRun()) return

      const chunkCount = Math.max(0, manifest.chunkCount)
      warmupMetricRef.current.details_chunk_total = chunkCount
      warmPointIndexByBangumiIdRef.current.clear()
      const chunkQueue = Array.from({ length: chunkCount }, (_, idx) => idx)
      let chunkDone = 0
      let pointsLoaded = 0
      let lastVisualSyncAt = 0
      if (chunkCount > 0) {
        updateTaskSafe('details', { percent: 0, detail: `${label.preloadDetails} (0/${chunkCount})` })
        const chunkStartedAt = performance.now()
        const workers = Math.min(PRELOAD_CHUNK_CONCURRENCY, chunkQueue.length)
        await Promise.all(Array.from({ length: workers }, async () => {
          for (;;) {
            if (signal?.aborted || !isActiveRun()) return
            const index = chunkQueue.shift()
            if (index == null) return

            const items = await withPromiseTimeout(
              fetchPreloadChunkByIndex(manifest, index, signal).catch(() => [] as AnitabiPreloadChunkItemDTO[]),
              WARMUP_PRELOAD_FETCH_TIMEOUT_MS + 1200,
              [] as AnitabiPreloadChunkItemDTO[],
              signal,
            )
            if (signal?.aborted || !isActiveRun()) return
            for (const item of items) {
              warmPointIndexByBangumiIdRef.current.set(item.bangumiId, item)
              pointsLoaded += item.points.length
            }

            chunkDone += 1
            warmupMetricRef.current.details_chunk_done = chunkDone
            warmupMetricRef.current.details_points_loaded = pointsLoaded
            updateTaskSafe('details', {
              percent: Math.round((chunkDone / chunkCount) * 100),
              detail: `${label.preloadDetails} (${chunkDone}/${chunkCount}) · ${pointsLoaded}`,
            })

            const now = performance.now()
            if (chunkDone === 1 || chunkDone === chunkCount || now - lastVisualSyncAt >= 900) {
              lastVisualSyncAt = now
              setTabCardsVersion((prev) => prev + 1)
            }
            if (chunkDone % 2 === 0) {
              await yieldToMainThread(signal)
            }
          }
        }))
        warmupMetricRef.current.chunks_ms = Math.round(performance.now() - chunkStartedAt)
      } else {
        updateTaskSafe('details', { percent: 100, detail: `${label.preloadDetails} (0/0)` })
      }

      if (signal?.aborted || !isActiveRun()) return
      const activeId = activeBangumiIdRef.current
      if (activeId == null) return
      const activeCard = Object.values(tabCardsRef.current).flatMap((rows) => rows || []).find((row) => row.id === activeId)
      const activeChunk = warmPointIndexByBangumiIdRef.current.get(activeId) || null
      if (!activeCard || !activeChunk) return
      setDetail((prev) => {
        if (!prev || prev.card.id !== activeCard.id) return prev
        if (prev.points.length > 0) return prev
        return buildWarmDetail(activeCard, activeChunk)
      })
    })()
      .then(() => {
        warmupMetricRef.current.promise_details_state = 2
      })
      .catch((error) => {
        warmupMetricRef.current.promise_details_state = -1
        throw error
      })

    warmupMetricRef.current.promise_images_state = 1
    const imagesWarmupPromise = (async () => {
      const manifest = await manifestPromise
      if (signal?.aborted || !isActiveRun()) return

      const blockingImages = new Set<string>()
      const queueCovers: string[] = []
      const pushBlockingImage = (src: string | null | undefined, targetQueue: string[]) => {
        const value = String(src || '').trim()
        if (!value || blockingImages.has(value) || prefetchedPointImageUrls.has(value) || prefetchingPointImageUrls.has(value)) return
        if (blockingImages.size >= PRELOAD_IMAGE_BLOCKING_MAX) return
        blockingImages.add(value)
        targetQueue.push(value)
      }

      const preferredTabs: AnitabiMapTab[] = ['latest', 'recent', 'hot', 'nearby']
      const currentTabCards = tabCardsRef.current[tab] || []
      for (const card of currentTabCards.slice(0, 40)) {
        pushBlockingImage(normalizeCoverImageUrl(card.cover), queueCovers)
      }
      for (const tabKey of preferredTabs) {
        const rows = manifest.tabs[tabKey] || []
        for (const card of rows.slice(0, 28)) {
          pushBlockingImage(normalizeCoverImageUrl(card.cover), queueCovers)
        }
      }

      let done = 0
      let inFlight = 0
      const deadline = Date.now() + WARMUP_BLOCKING_BUDGET_MS
      const updateImagesProgress = (total: number, force = false) => {
        if (total <= 0) {
          updateTaskSafe('images', { percent: 100, detail: `${label.preloadImages} (0/0)` })
          return
        }
        const clampedDone = Math.min(done, total)
        const percentRaw = Math.floor((clampedDone / total) * 100)
        const percent = clampedDone >= total ? 100 : Math.max(0, Math.min(99, percentRaw))
        if (!force && clampedDone !== total && clampedDone % 8 !== 0) return
        updateTaskSafe('images', {
          percent,
          detail: `${label.preloadImages} (${clampedDone}/${total})`,
        })
      }
      const runQueue = async (queue: string[], total: number) => {
        if (!queue.length || total <= 0) return
        warmupMetricRef.current.images_total = total
        warmupMetricRef.current.images_queue_remaining = queue.length
        const workers = Math.min(getImageWarmupConcurrency(false), queue.length)
        await Promise.all(Array.from({ length: workers }, async () => {
          for (;;) {
            if (signal?.aborted || Date.now() > deadline || !isActiveRun()) return
            const src = queue.shift()
            if (!src) return
            warmupMetricRef.current.images_queue_remaining = queue.length
            inFlight += 1
            warmupMetricRef.current.images_inflight = inFlight
            warmupMetricRef.current.images_last_src = src
            try {
              await withPromiseTimeout(
                prefetchImageUrl(src, { signal, timeoutMs: WARMUP_IMAGE_TIMEOUT_MS }).catch(() => null),
                WARMUP_IMAGE_TIMEOUT_MS + 300,
                undefined,
                signal,
              )
            } finally {
              inFlight = Math.max(0, inFlight - 1)
              warmupMetricRef.current.images_inflight = inFlight
            }
            if (signal?.aborted || !isActiveRun()) return
            done += 1
            warmupMetricRef.current.images_done = done
            updateImagesProgress(total)
            if (done % 6 === 0) {
              await yieldToMainThread(signal)
            }
          }
        }))
      }

      updateTaskSafe('images', { percent: 0, detail: `${label.preloadImages} (0/${queueCovers.length})` })
      await runQueue(queueCovers, queueCovers.length)
      if (signal?.aborted || !isActiveRun()) return
      if (Date.now() > deadline) {
        warmupMetricRef.current.images_blocking_truncated = 1
        updateImagesProgress(queueCovers.length, true)
        return
      }

      await detailsWarmupPromise
      if (signal?.aborted || !isActiveRun()) return
      if (Date.now() > deadline) {
        warmupMetricRef.current.images_blocking_truncated = 1
        updateImagesProgress(queueCovers.length, true)
        return
      }

      const queueActive: string[] = []
      const activeId = activeBangumiIdRef.current
      if (activeId != null) {
        const item = warmPointIndexByBangumiIdRef.current.get(activeId) || null
        if (item) {
          for (const point of item.points.slice(0, WARMUP_ACTIVE_DETAIL_IMAGE_MAX)) {
            pushBlockingImage(normalizePointImageUrl(point.image), queueActive)
          }
        }
      }

      const total = done + queueActive.length
      if (total <= 0) {
        updateTaskSafe('images', { percent: 100, detail: `${label.preloadImages} (0/0)` })
        return
      }
      if (queueActive.length > 0) {
        updateImagesProgress(total, true)
      }
      await runQueue(queueActive, total)
      if (signal?.aborted || !isActiveRun()) return
      if (Date.now() > deadline) {
        warmupMetricRef.current.images_blocking_truncated = 1
      }
      updateImagesProgress(total, true)
    })()
      .then(() => {
        warmupMetricRef.current.promise_images_state = 2
      })
      .catch((error) => {
        warmupMetricRef.current.promise_images_state = -1
        throw error
      })

    await Promise.all([mapWarmupPromise, detailsWarmupPromise, imagesWarmupPromise])
    if (signal?.aborted || !isActiveRun()) {
      if (isActiveRun()) {
        warmupMetricRef.current.warmup_aborted = 1
        warmupBlockingUiRef.current = false
        setWarmupUiBlocking(false)
        updateProgressSafe({ phase: 'idle', percent: 0, detail: '' })
      }
      return
    }

    completeTasksSafe()
    updateProgressSafe({ phase: 'done', percent: 100, detail: label.preloadDone })
    warmupBlockingUiRef.current = false
    setWarmupUiBlocking(false)
    warmupMetricRef.current.warmup_aborted = 0
    warmupMetricRef.current.unlock_ms = Math.round(performance.now() - startedAt)
    window.setTimeout(() => {
      if (!isActiveRun()) return
      setWarmupProgress((prev) => (prev.phase === 'done'
        ? { ...prev, phase: 'idle', percent: 100, detail: label.preloadDone }
        : prev))
    }, 700)

    const backgroundStartedAt = performance.now()
    const backgroundImages = new Set<string>()
    for (const rows of Object.values(tabCardsRef.current)) {
      for (const card of rows || []) {
        const cover = normalizeCoverImageUrl(card.cover)
        if (cover) backgroundImages.add(cover)
      }
    }
    for (const item of warmPointIndexByBangumiIdRef.current.values()) {
      for (const point of item.points) {
        const img = normalizePointImageUrl(point.image)
        if (img) backgroundImages.add(img)
        if (backgroundImages.size >= PRELOAD_IMAGE_BACKGROUND_MAX) break
      }
      if (backgroundImages.size >= PRELOAD_IMAGE_BACKGROUND_MAX) break
    }
    const bgQueue = Array.from(backgroundImages).filter((src) => !prefetchedPointImageUrls.has(src))
    if (!signal?.aborted && isActiveRun() && bgQueue.length > 0) {
      void Promise.all(Array.from({ length: Math.min(getImageWarmupConcurrency(true), bgQueue.length) }, async () => {
        for (;;) {
          if (signal?.aborted || !isActiveRun()) return
          const src = bgQueue.shift()
          if (!src) return
          await prefetchImageUrl(src, { signal, timeoutMs: 2200 }).catch(() => null)
        }
      })).finally(() => {
        warmupMetricRef.current.bg_images_ms = Math.round(performance.now() - backgroundStartedAt)
      })
    } else {
      warmupMetricRef.current.bg_images_ms = 0
    }
  }, [
    completeAllWarmupTasks,
    fetchPreloadChunkByIndex,
    fetchPreloadManifest,
    hydrateTabCardsFromManifest,
    label.preloadCards,
    label.preloadDetails,
    label.preloadDone,
    label.preloadImages,
    label.preloadMapPreparing,
    updateWarmupTask,
    preloadMapBaseLayer,
    resetWarmupTaskProgress,
    updateWarmupProgress,
  ])

  const loadMoreCards = useCallback(async () => {
    if (tab !== 'nearby') return
    if (loading || loadingMoreCards || !hasMoreCards) return
    if (tab === 'nearby' && !userLocation) return
    const requestToken = cardFeedTokenRef.current
    const params = new URLSearchParams()
    params.set('locale', locale)
    params.set('tab', tab)
    params.set('size', String(CARD_PAGE_SIZE))
    if (query) params.set('q', query)
    if (selectedCity) params.set('city', selectedCity)
    if (tab === 'nearby' && userLocation) {
      params.set('ulat', userLocation.lat.toFixed(6))
      params.set('ulng', userLocation.lng.toFixed(6))
    }

    setLoadingMoreCards(true)
    setCardsLoadError(null)
    try {
      const res = await fetch(`/api/anitabi/chunks/${nextChunkIndex}?${params.toString()}`, { method: 'GET' })
      const json = (await res.json().catch(() => ({}))) as { items?: AnitabiBangumiCard[] }
      if (!res.ok) throw new Error(label.loadMoreFailed)
      if (requestToken !== cardFeedTokenRef.current) return

      const items = Array.isArray(json.items) ? json.items : []
      setCards((prev) => {
        const seen = new Set(prev.map((row) => row.id))
        const merged = prev.slice()
        for (const item of items) {
          if (seen.has(item.id)) continue
          seen.add(item.id)
          merged.push(item)
        }
        return merged
      })
      setNextChunkIndex((prev) => prev + 1)
      setHasMoreCards(items.length >= CARD_PAGE_SIZE)
    } catch {
      if (requestToken !== cardFeedTokenRef.current) return
      setCardsLoadError(label.loadMoreFailed)
    } finally {
      if (requestToken !== cardFeedTokenRef.current) return
      setLoadingMoreCards(false)
    }
  }, [hasMoreCards, label.loadMoreFailed, loading, loadingMoreCards, locale, nextChunkIndex, query, selectedCity, tab, userLocation])

  const openBangumi = useCallback(
    async (id: number, pointId?: string | null) => {
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
        setMobilePointPopupOpen(false)
        setMobilePanelOpen(false)
      }
      setDetailLoading(true)
      const card = cards.find((c) => c.id === id)
        || Object.values(tabCardsRef.current).flatMap((rows) => rows || []).find((c) => c.id === id)
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
        // L2 → L1 promotion: check IndexedDB cache before FIFO memory cache
        if (!bangumiDetailCache.has(id) && cacheStoreRef.current) {
          try {
            const cachedL2 = await cacheStoreRef.current.getDetail(id)
            if (cachedL2) cachePut(id, cachedL2.detail)
          } catch {
            // L2 cache read failed, proceed with API fetch
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
        // Persist to L2 cache (IndexedDB)
        if (cacheStoreRef.current) {
          cacheStoreRef.current.getVersion().then(version => {
            if (!version) return
            cacheStoreRef.current?.putDetail(id, {
              datasetVersion: version,
              bangumiId: id,
              detail: json,
              cachedAt: Date.now(),
            }).catch(() => null)
          }).catch(() => null)
        }
        // Guard: if user already switched to another bangumi, discard this response
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
    [cards, fitBangumiBounds, flushPointLayerSoon, focusGeo, isDesktop, locale]
  )

  // Keep openBangumiRef in sync for Complete Mode click handler
  useEffect(() => {
    openBangumiRef.current = openBangumi
  }, [openBangumi])


  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const handleCardPointerEnter = useCallback(
    (id: number) => {
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = setTimeout(() => prefetchBangumi(id), 150)
    },
    [prefetchBangumi]
  )
  const handleCardPointerLeave = useCallback(() => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = null
    }
  }, [])
  useEffect(() => {
    return () => {
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
      if (prefetchAbort) prefetchAbort.abort()
      warmupRunTokenRef.current += 1
      warmupAbortRef.current?.abort()
      if (pointLayerFallbackTimerRef.current != null) {
        window.clearTimeout(pointLayerFallbackTimerRef.current)
        pointLayerFallbackTimerRef.current = null
      }
      if (rangeOverlayFallbackTimerRef.current != null) {
        window.clearTimeout(rangeOverlayFallbackTimerRef.current)
        rangeOverlayFallbackTimerRef.current = null
      }
      if (firstOpenPointGuardTimerRef.current != null) {
        window.clearTimeout(firstOpenPointGuardTimerRef.current)
        firstOpenPointGuardTimerRef.current = null
      }
    }
  }, [])

  // Initialize L2 cache store
  useEffect(() => {
    let cancelled = false
    createCacheStore().then((store) => {
      if (!cancelled) {
        cacheStoreRef.current = store
        setCacheStoreReady(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Start full warmup once cache is ready.
  useEffect(() => {
    if (!cacheStoreReady) return
    if (!MAP_PRELOAD_V2_ENABLED) {
      setWarmupUiBlocking(false)
      loadBootstrap().catch(() => null)
      return
    }
    const ac = new AbortController()
    warmupRunTokenRef.current += 1
    warmupAbortRef.current?.abort()
    warmupAbortRef.current = ac
    ;(async () => {
      const hydratedFromCache = await hydrateTabCardsFromCache(ac.signal)
      if (ac.signal.aborted) return

      let hasCachedWarmPointData = false
      if (cacheStoreRef.current) {
        const cachedManifest = await cacheStoreRef.current.getPreloadManifest().catch(() => null)
        if (ac.signal.aborted) return
        const chunkCount = cachedManifest?.manifest?.chunkCount || 0
        if (chunkCount <= 0) {
          hasCachedWarmPointData = true
        } else {
          const firstChunk = await cacheStoreRef.current.getPreloadChunk(0).catch(() => null)
          if (ac.signal.aborted) return
          hasCachedWarmPointData = Boolean(firstChunk?.chunk?.items?.length)
        }
      }
      const runInBackground = hydratedFromCache && hasCachedWarmPointData
      if (!runInBackground) {
        setLoading(true)
        setCards([])
      } else {
        setLoading(false)
      }

      warmupAllTabsData({ signal: ac.signal, background: runInBackground }).catch(() => {
        if (ac.signal.aborted) return
        setCardsLoadError(label.loadMoreFailed)
        resetWarmupTaskProgress()
        updateWarmupProgress({ phase: 'idle', percent: 0, detail: '' })
        warmupBlockingUiRef.current = false
        setWarmupUiBlocking(false)
      })
    })().catch(() => null)
    return () => {
      warmupRunTokenRef.current += 1
      ac.abort()
      warmupBlockingUiRef.current = false
      setWarmupUiBlocking(false)
      if (warmupAbortRef.current === ac) warmupAbortRef.current = null
    }
  }, [
    cacheStoreReady,
    hydrateTabCardsFromCache,
    label.loadMoreFailed,
    loadBootstrap,
    resetWarmupTaskProgress,
    updateWarmupProgress,
    warmupAllTabsData,
  ])

  // If progress reaches 100 but async tail tasks keep phase in loading, unlock UI and
  // normalize phase so complete-mode rendering is not blocked.
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
    if (typeof window === 'undefined') return
    if (warmupProgress.phase !== 'loading') return

    type WarmupDebugWindow = Window & {
      __SEICHIGO_WARMUP_DEBUG__?: Record<string, unknown>
      __SEICHIGO_WARMUP_DEBUG_HISTORY__?: Array<Record<string, unknown>>
    }
    const target = window as WarmupDebugWindow
    const emitSnapshot = (reason: string, warn = false) => {
      const now = Date.now()
      const lastProgressAt = Number(warmupMetricRef.current.last_progress_at || 0)
      const idleMs = lastProgressAt > 0 ? now - lastProgressAt : 0
      const snapshot = {
        reason,
        now,
        idleMs,
        runToken: warmupMetricRef.current.warmup_run_token || 0,
        phase: warmupProgressRef.current.phase,
        percent: warmupProgressRef.current.percent,
        detail: warmupProgressRef.current.detail,
        taskProgress: warmupTaskProgressRef.current,
        metrics: { ...warmupMetricRef.current },
      }
      target.__SEICHIGO_WARMUP_DEBUG__ = snapshot
      const history = target.__SEICHIGO_WARMUP_DEBUG_HISTORY__ || []
      history.push(snapshot)
      if (history.length > 36) history.shift()
      target.__SEICHIGO_WARMUP_DEBUG_HISTORY__ = history
      if (warn) {
        console.warn('[warmup-debug]', snapshot)
      } else {
        console.debug('[warmup-debug]', snapshot)
      }
    }

    emitSnapshot('loading-start')
    const timer = window.setInterval(() => {
      const now = Date.now()
      const lastProgressAt = Number(warmupMetricRef.current.last_progress_at || 0)
      const idleMs = lastProgressAt > 0 ? now - lastProgressAt : 0
      warmupMetricRef.current.watchdog_last_tick = now
      warmupMetricRef.current.watchdog_idle_ms = idleMs
      emitSnapshot('watchdog-tick', idleMs >= WARMUP_STALL_WARN_MS)
    }, WARMUP_WATCHDOG_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      emitSnapshot('loading-stop')
    }
  }, [warmupProgress.phase])

  // Nearby tab: prefer preloaded full dataset; fallback to bootstrap+chunks when unavailable.
  useEffect(() => {
    if (tab !== 'nearby') return
    const nearbyCards = tabCardsRef.current.nearby || []
    if (loadedTabsRef.current.has('nearby') || Object.prototype.hasOwnProperty.call(tabCardsRef.current, 'nearby')) {
      loadedTabsRef.current.add('nearby')
      const hasSyncedSearchResult = normalizeSearchKeyword(queryInput) === normalizeSearchKeyword(query)
      const rankedByLocation = userLocation
        ? nearbyCards
            .map((card) => {
              const preload = warmPointIndexByBangumiIdRef.current.get(card.id)
              let nearest: number | null = null
              if (preload?.points?.length) {
                for (const point of preload.points) {
                  if (!isValidGeoPair(point.geo)) continue
                  const dist = distanceMeters([userLocation.lng, userLocation.lat], [point.geo[1], point.geo[0]])
                  if (nearest == null || dist < nearest) nearest = dist
                }
              } else if (isValidGeoPair(card.geo)) {
                nearest = distanceMeters([userLocation.lng, userLocation.lat], [card.geo[1], card.geo[0]])
              }
              return {
                ...card,
                nearestDistanceMeters: nearest != null ? Math.round(nearest) : null,
              }
            })
            .sort((a, b) => {
              const aDist = a.nearestDistanceMeters
              const bDist = b.nearestDistanceMeters
              if (aDist != null && bDist != null && aDist !== bDist) return aDist - bDist
              if (aDist != null) return -1
              if (bDist != null) return 1
              return a.id - b.id
            })
        : nearbyCards
      setCards(filterBulkCardsBySearch(rankedByLocation, query, selectedCity, hasSyncedSearchResult ? searchResult : null))
      setHasMoreCards(false)
      setLoading(false)
      return
    }
    if (!userLocation) {
      setCards([])
      setHasMoreCards(false)
      setLoading(false)
      return
    }
    if (warmupProgress.phase === 'loading' && warmupProgress.percent < 100) return
    if (ssrBootstrapUsedRef.current && initialBootstrap && initialBootstrap.tab === tab) {
      ssrBootstrapUsedRef.current = false
      tabCardsRef.current.nearby = initialBootstrap.cards
      loadedTabsRef.current.add('nearby')
      setTabCardsVersion((prev) => prev + 1)
      setHasMoreCards((initialBootstrap?.cards.length ?? 0) >= CARD_PAGE_SIZE)
      return
    }
    loadBootstrap().catch(() => null)
  }, [initialBootstrap, loadBootstrap, query, queryInput, searchResult, selectedCity, tab, tabCardsVersion, userLocation, warmupProgress.percent, warmupProgress.phase])

  // Client-side city + keyword filtering for non-nearby tabs
  useEffect(() => {
    if (tab === 'nearby') return
    const hasLocalTabCards = Object.prototype.hasOwnProperty.call(tabCardsRef.current, tab)
    const isTabLoaded = loadedTabsRef.current.has(tab) || hasLocalTabCards
    if (!isTabLoaded) {
      setCards([])
      setHasMoreCards(false)
      if (cacheStoreReady) {
        setLoading(warmupProgress.phase === 'loading' && warmupProgress.percent < 100)
      }
      return
    }
    loadedTabsRef.current.add(tab)
    const all = tabCardsRef.current[tab] || []
    const hasSyncedSearchResult = normalizeSearchKeyword(queryInput) === normalizeSearchKeyword(query)
    setCards(filterBulkCardsBySearch(all, query, selectedCity, hasSyncedSearchResult ? searchResult : null))
    setHasMoreCards(false)
    setLoading(false)
  }, [cacheStoreReady, query, queryInput, searchResult, selectedCity, tab, tabCardsVersion, warmupProgress.percent, warmupProgress.phase])

  useEffect(() => {
    if (loading || loadingMoreCards || !hasMoreCards) return
    const root = cardsContainerRef.current
    const target = cardsLoadMoreRef.current
    if (!root || !target) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        loadMoreCards().catch(() => null)
      },
      {
        root,
        rootMargin: CARD_LIST_PREFETCH_ROOT_MARGIN,
        threshold: 0,
      }
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [cards.length, hasMoreCards, loadMoreCards, loading, loadingMoreCards])

  useEffect(() => {
    let cancelled = false
    const run = () => {
      if (cancelled) return
      loadMe().catch(() => null)
    }

    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    if (typeof win.requestIdleCallback === 'function' && typeof win.cancelIdleCallback === 'function') {
      const id = win.requestIdleCallback(run, { timeout: 1200 })
      return () => {
        cancelled = true
        win.cancelIdleCallback?.(id)
      }
    }

    const timer = setTimeout(run, 280)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [loadMe])

  useEffect(() => {
    if (selectedBangumiId == null || detailLoading) return

    const sameBangumi = detail?.card.id === selectedBangumiId
    const samePoint = selectedPointId == null || selectedPoint != null
    if (sameBangumi && samePoint) return

    openBangumi(selectedBangumiId, selectedPointId).catch(() => null)
  }, [detail?.card.id, detailLoading, openBangumi, selectedBangumiId, selectedPoint, selectedPointId])

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
      fadeDuration: 0,
    })

    const clearStyleFailoverTimer = () => {
      if (styleFailoverTimerRef.current != null) {
        window.clearTimeout(styleFailoverTimerRef.current)
        styleFailoverTimerRef.current = null
      }
    }

    const armStyleFailoverGuard = (mode: MapStyleMode, providerIndex: number) => {
      clearStyleFailoverTimer()
      styleAttemptRef.current += 1
      const attempt = styleAttemptRef.current
      styleErrorBurstRef.current = { count: 0, startedAt: 0 }
      styleFailoverTimerRef.current = window.setTimeout(() => {
        if (styleAttemptRef.current !== attempt) return
        if (currentStyleModeRef.current !== mode) return
        const candidates = getMapStyleCandidates(mode)
        if (providerIndex >= candidates.length - 1) return
        void switchStyleProvider(mode, providerIndex + 1, 'timeout')
      }, MAP_STYLE_FAILOVER_TIMEOUT_MS)
    }

    function switchStyleProvider(mode: MapStyleMode, providerIndex: number, reason: string): boolean {
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

    applyMapStyleRef.current = (mode, options) => {
      const resetProvider = Boolean(options?.resetProvider)
      const providerIndex = resetProvider ? 0 : (styleProviderIndexRef.current[mode] || 0)
      void switchStyleProvider(mode, providerIndex, options?.reason || 'external')
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
          openBangumiRef.current?.(completeTarget.bangumiId, completeTarget.pointId)?.catch(() => null)
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
      const target = activeDetail?.points.find((point) => matchPointId(point.id, pointId)) || null
      if (target) {
        const sameAsPrev = Boolean(prevPointId && (matchPointId(pointId, prevPointId) || matchPointId(prevPointId, pointId)))
        const panorama = resolvePanoramaEmbed(target)
        if (sameAsPrev && map.getZoom() >= PANORAMA_TRIGGER_ZOOM && panorama) {
          setMapViewMode('panorama')
        } else if (isValidGeoPair(target.geo)) {
          focusGeo(target.geo, Math.max(map.getZoom(), 13.5), true)
        }
      }
      if (meStateRef.current) {
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
      void switchStyleProvider(mode, idx + 1, 'error')
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
        // Ignore duplicate/invalid image add attempts.
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
  }, [focusGeo, parsed.lat, parsed.lng, parsed.z, schedulePointLayerFallbackFlush, scheduleRangeOverlayFallbackFlush])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (currentStyleModeRef.current === styleMode) return
    applyMapStyleRef.current(styleMode, { resetProvider: true, reason: 'mode-change' })
  }, [styleMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const ok = syncPointLayerRef.current()
    if (!ok) {
      flushPointLayerSoon()
    }
  }, [detail, flushPointLayerSoon, selectedPointId, stateFilter, viewFilter, meState])
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
  }, [detail, scheduleRangeOverlayFallbackFlush, syncRangeOverlay])

  useEffect(() => {
    syncUrl()
  }, [syncUrl])

  useEffect(() => {
    const q = queryInput.trim()
    if (!q) {
      setSearchResult({ bangumi: [], points: [], cities: [] })
      return
    }

    const ctrl = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/anitabi/search?locale=${encodeURIComponent(locale)}&q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) return
        const json = (await res.json()) as SearchResult
        setSearchResult({
          bangumi: Array.isArray(json.bangumi) ? json.bangumi : [],
          points: Array.isArray(json.points) ? json.points : [],
          cities: Array.isArray(json.cities) ? json.cities : [],
        })
      } catch {
        // ignore
      }
    }, 220)

    return () => {
      ctrl.abort()
      window.clearTimeout(t)
    }
  }, [locale, queryInput])


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

  const tabs = bootstrap?.tabs || [
    { key: 'nearby' as const, label: label.nearby },
    { key: 'latest' as const, label: label.latest },
    { key: 'recent' as const, label: label.recent },
    { key: 'hot' as const, label: label.hot },
  ]
  const warmupReady = warmupProgress.percent >= 100
  const warmupActive = warmupProgress.phase === 'loading' && !warmupReady
  const iconPreppingActive = completeModeLoading && !warmupActive
  const mergedLoadingVisible = warmupActive || iconPreppingActive
  const mergedLoadingPercent = iconPreppingActive ? 99 : warmupProgress.percent
  const mergedLoadingTitle = iconPreppingActive ? label.preloadIconsTitle : warmupProgress.title
  const mergedLoadingDetail = iconPreppingActive ? label.preloadIconsDetail : warmupProgress.detail
  const warmupBlocking = false
  const warmupTaskRows = [
    { key: 'map' as const, title: label.preloadMap, progress: warmupTaskProgress.map },
    { key: 'cards' as const, title: label.preloadCards, progress: warmupTaskProgress.cards },
    { key: 'details' as const, title: label.preloadDetails, progress: warmupTaskProgress.details },
    { key: 'images' as const, title: label.preloadImages, progress: warmupTaskProgress.images },
  ]
  const activeWarmupTask = warmupTaskRows.find((task) => task.progress.percent < 100) || warmupTaskRows[warmupTaskRows.length - 1] || null
  const showNearbyLocationCta = !loading && tab === 'nearby' && !userLocation
  const hasSearchQuery = normalizeSearchKeyword(query).length > 0

  const detailPanelInner = detail ? (
    <>
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div>
          <div className="flex items-center gap-2">
            <div className="line-clamp-1 text-sm font-semibold text-slate-900">{detail.card.title}</div>
            {isBangumiCompleted && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-600 border border-brand-100 shadow-sm hover:bg-brand-100"
                onClick={() => setShowRouteBookCard(true)}
              >
                生成战报
              </button>
            )}
          </div>
          <div className="text-xs text-slate-500">{detail.card.city || '-'} · {detail.points.length} {label.points}</div>
        </div>
        <div className="flex items-center gap-1">
          <a
            href="/me/routebooks"
            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 no-underline"
          >
            {label.routeBooks}
          </a>
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
            onClick={() => {
              setDetail(null)
              setDetailCardMode('bangumi')
              setWorkDetailExpanded(false)
              setSelectedPointId(null)
              setMobilePointPopupOpen(false)
              setMapViewMode('map')
            }}
          >
            {label.close}
          </button>
        </div>
      </div>

      {detailCardMode === 'point' && selectedPoint ? (
        <div className="space-y-2 border-b border-slate-200 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label.pointDetail}</div>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
              onClick={switchToBangumiDetail}
            >
              {label.backToWorkDetail}
            </button>
          </div>
          <div className="text-sm font-medium text-slate-900">{selectedPoint.name}</div>
          {renderPointImage(selectedPointImage.previewUrl, selectedPoint.name, selectedPointImage.downloadUrl, true)}
          <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
            {selectedPoint.ep ? <span>EP {selectedPoint.ep}</span> : null}
            {selectedPoint.s ? <span>· {selectedPoint.s}</span> : null}
            {selectedPoint.origin ? <span>· {selectedPoint.origin}</span> : null}
            {selectedPointDistanceMeters != null ? <span>· ~{formatDistance(selectedPointDistanceMeters)}</span> : null}
          </div>
          {selectedPoint.note ? (
            <div className="rounded-md bg-slate-50 px-2 py-1 text-xs leading-relaxed text-slate-700">
              {selectedPoint.note}
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
            <div className="text-[11px] text-slate-600">{label.stateAutoHint}</div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              {(['want_to_go', 'planned', 'checked_in'] as const).map((state) => (
                <span
                  key={state}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    selectedPointState === state
                      ? state === 'checked_in'
                        ? 'bg-green-500 text-white'
                        : state === 'planned'
                          ? 'bg-orange-500 text-white'
                          : 'bg-blue-500 text-white'
                      : 'bg-white text-slate-500 ring-1 ring-slate-200'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {state === 'checked_in' ? label.checkedIn : state === 'planned' ? label.planned : label.wantToGo}
                </span>
              ))}
            </div>
            {selectedPointState === 'want_to_go' ? (
              <div className="mt-2 text-[11px] text-blue-600">{label.pointAlreadyInPoolHint}</div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {geoLink(selectedPoint) ? (
              <a className="inline-flex min-w-[92px] items-center justify-center rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white no-underline hover:bg-slate-700" href={geoLink(selectedPoint) || '#'} target="_blank" rel="noreferrer">
                {label.openInGoogle}
              </a>
            ) : null}
            <button
              type="button"
              className="inline-flex min-w-[92px] items-center justify-center rounded bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-55"
              onClick={enterPanorama}
              disabled={!selectedPointPanorama}
              title={selectedPointPanorama ? undefined : label.panoramaUnavailable}
            >
              {label.enterPanorama}
            </button>
            {showWantToGoAction ? (
              <button
                type="button"
                className="inline-flex min-w-[108px] items-center justify-center rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                onClick={() => {
                  addPointToPointPool(selectedPoint.id).catch(() => null)
                }}
              >
                {label.addToPointPool}
              </button>
            ) : null}
            {meState?.pointStates.find((ps) => ps.pointId === selectedPoint.id && ps.state === 'checked_in') && (
              <button
                type="button"
                className="inline-flex min-w-[92px] items-center justify-center rounded border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
                onClick={() => setShowCheckInCard(true)}
              >
                打卡卡片
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-3 border-b border-slate-200 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label.workDetail}</div>
            <div className="flex items-start gap-3">
              <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                {detail.card.cover ? (
                  <img
                    src={detail.card.cover}
                    alt={detail.card.title}
                    width={96}
                    height={144}
                    className="h-full w-full object-cover"
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-slate-200 text-base font-semibold text-slate-600">
                    {detail.card.title.slice(0, 1)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="line-clamp-1 text-sm font-semibold text-slate-900">{detail.card.title}</div>
                <div className="text-[11px] text-slate-500">
                  {detail.card.city || '-'} · {detailLoading ? (
                    <span className="inline-block h-3 w-8 animate-pulse rounded bg-slate-100 align-middle" />
                  ) : (
                    detail.points.length
                  )} {label.points}
                </div>
                {detailLoading ? (
                  <div className="space-y-1 py-1">
                    <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
                  </div>
                ) : detail.description ? (
                  <div className="space-y-1">
                    <div className={workDetailExpanded ? 'max-h-40 overflow-y-auto pr-1' : ''}>
                      <p className={`text-xs leading-relaxed text-slate-700 ${workDetailExpanded ? '' : 'line-clamp-6'}`}>
                        {detail.description}
                      </p>
                    </div>
                    {detail.description.length > 140 ? (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                        onClick={() => setWorkDetailExpanded((prev) => !prev)}
                      >
                        {workDetailExpanded ? label.collapseWorkDetail : label.expandWorkDetail}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-slate-500">{label.noData}</p>
                )}
              </div>
            </div>
            {detailLoading ? (
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-4 w-12 animate-pulse rounded-full bg-slate-100" />
                ))}
              </div>
            ) : detail.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {detail.tags.slice(0, 8).map((tag) => (
                  <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="rounded-lg border border-brand-100 bg-brand-50/70 px-2 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-brand-700">{label.quickPilgrimage}</div>
                  <div className="line-clamp-2 text-[11px] text-brand-600">{label.quickPilgrimageHint}</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded bg-brand-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-600"
                  onClick={() => setShowQuickPilgrimage(true)}
                >
                  {label.quickPilgrimage}
                </button>
              </div>
              <div className="mt-1 text-[11px] text-brand-700">
                {label.quickPilgrimageProgressPrefix} {quickPilgrimageProgress.checked}/{quickPilgrimageProgress.total}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex rounded bg-slate-200/50 p-0.5">
              <button
                type="button"
                onClick={() => setViewFilter('all')}
                className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                  viewFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label.allPoints}
              </button>
              <button
                type="button"
                onClick={() => setViewFilter('marked')}
                className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                  viewFilter === 'marked' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label.onlyMarked}
              </button>
            </div>

            {viewFilter === 'marked' && (
              <div className="flex w-full flex-wrap items-center justify-center gap-1.5">
                {(['want_to_go', 'planned', 'checked_in'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setStateFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
                    }}
                    className={`flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-medium transition ${
                      stateFilter.includes(s) || stateFilter.length === 0
                        ? s === 'checked_in'
                          ? 'bg-green-500 text-white'
                          : s === 'planned'
                            ? 'bg-orange-500 text-white'
                            : 'bg-blue-500 text-white'
                        : 'bg-slate-200 text-slate-400'
                    }`}
                  >
                    <div className="h-1 w-1 rounded-full bg-white" />
                    {s === 'checked_in' ? label.checkedIn : s === 'planned' ? label.planned : label.wantToGo}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="max-h-[420px] overflow-auto px-3 py-2">
            {detailLoading ? (
              <div className="space-y-3 py-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex flex-col gap-2 rounded px-2 py-1.5">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : null}
            {!detailLoading && detailPoints.length === 0 ? <div className="py-4 text-sm text-slate-500">{label.noData}</div> : null}
            <div className="space-y-1">
              {detailPoints.map(({ point, distanceMeters: pointDistance }) => {
                const pointState = meState?.pointStates.find((ps) => ps.pointId === point.id)?.state || 'none'
                const showPointWantToGo = pointState === 'none'
                return (
                  <div
                    key={point.id}
                    className={`block w-full rounded px-2 py-1.5 text-left text-xs ${
                      selectedPoint?.id === point.id ? 'bg-brand-100 text-brand-800' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setDetailCardMode('point')
                          setSelectedPointId(point.id)
                          if (!isDesktopRef.current) setMobilePointPopupOpen(false)
                          if (mapViewMode === 'panorama') return
                          if (point.geo && mapRef.current) {
                            focusGeo(point.geo, Math.max(mapRef.current.getZoom(), 13.5), true)
                          }
                        }}
                      >
                        <div className="line-clamp-1 font-medium">{point.name}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {point.ep ? `EP ${point.ep}` : ''}
                          {pointDistance != null ? `${point.ep ? ' · ' : ''}~${formatDistance(pointDistance)}` : ''}
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {pointState === 'want_to_go' ? (
                          <span className="rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white">{label.wantToGo}</span>
                        ) : null}
                        {pointState === 'planned' ? (
                          <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-medium text-white">{label.planned}</span>
                        ) : null}
                        {pointState === 'checked_in' ? (
                          <span className="rounded-full bg-green-500 px-1.5 py-0.5 text-[10px] font-medium text-white">{label.checkedIn}</span>
                        ) : null}
                        {showPointWantToGo ? (
                          <button
                            type="button"
                            className="rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
                            onClick={(event) => {
                              event.stopPropagation()
                              addPointToPointPool(point.id).catch(() => null)
                            }}
                          >
                            {label.addToPointPool}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  ) : null

  const explorerHeader = (
    <div className="space-y-3 border-b border-slate-200 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900">{label.title}</h1>
        <div className="flex items-center gap-1">
          <button
            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
            onClick={() => setStyleMode(styleMode === 'street' ? 'satellite' : 'street')}
            type="button"
          >
            {styleMode === 'street' ? label.satellite : label.street}
          </button>
          <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100" onClick={onRandom} type="button">
            {label.random}
          </button>
        </div>
      </div>

      <div className="relative">
        <div className="flex gap-2">
          <input
            id="anitabi-map-search"
            name="q"
            value={queryInput}
            onFocus={() => setSearchOpen(true)}
            onChange={(e) => {
              const next = e.target.value
              setQueryInput(next)
              if (!next.trim() && query) {
                setQuery('')
                setSearchOpen(false)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmitQuery()
            }}
            placeholder={label.searchPlaceholder}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400"
          />
          <button className="rounded-md bg-brand-500 px-3 py-2 text-xs font-medium text-white hover:bg-brand-600" onClick={onSubmitQuery} type="button">
            {label.search}
          </button>
        </div>

        {searchOpen && (searchResult.bangumi.length > 0 || searchResult.points.length > 0 || searchResult.cities.length > 0) ? (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-xl">
            {searchResult.cities.slice(0, 6).map((city) => (
              <button
                key={`city:${city}`}
                type="button"
                className="mb-1 block w-full rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  setSelectedCity(city)
                  setSearchOpen(false)
                }}
              >
                {label.searchCityPrefix}：{city}
              </button>
            ))}
            {searchResult.bangumi.slice(0, 10).map((item) => (
              <button
                key={`bangumi:${item.id}`}
                type="button"
                className="mb-1 block w-full rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  openBangumi(item.id).catch(() => null)
                  setSearchOpen(false)
                }}
              >
                {label.searchAnimePrefix}：{item.title}
              </button>
            ))}
            {searchResult.points.slice(0, 10).map((point) => (
              <button
                key={`point:${point.id}`}
                type="button"
                className="mb-1 block w-full rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  openBangumi(point.bangumiId, point.id).catch(() => null)
                  setSearchOpen(false)
                }}
              >
                {label.searchPointPrefix}：{point.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-full border px-2 py-1 text-xs ${!selectedCity ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
          onClick={() => setSelectedCity('')}
        >
          {label.allCities}
        </button>
        {(bootstrap?.facets.cities || []).map((city) => (
          <button
            key={city}
            type="button"
            className={`rounded-full border px-2 py-1 text-xs ${selectedCity === city ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
            onClick={() => setSelectedCity(city)}
          >
            {city}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs ${tab === item.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )

  const cardsList = (
    <>
      {showNearbyLocationCta ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 text-center">
          <div className="text-sm text-slate-500">{label.nearbyNeedLocation}</div>
          <button
            type="button"
            className="rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onLocate}
            disabled={locating}
          >
            {locating ? label.locating : label.nearbyGrantLocation}
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex animate-pulse items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
              <div className="h-16 w-12 shrink-0 rounded-md bg-slate-200" />
              <div className="min-w-0 flex-1 space-y-2 py-0.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="h-4 w-32 rounded bg-slate-200" />
                  <div className="h-4 w-10 rounded-full bg-slate-200" />
                </div>
                <div className="h-3 w-48 rounded bg-slate-200" />
                <div className="mt-2 flex gap-1.5">
                  <div className="h-4 w-12 rounded-full bg-slate-100" />
                  <div className="h-4 w-12 rounded-full bg-slate-100" />
                  <div className="h-4 w-12 rounded-full bg-slate-100" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {!loading && (tab !== 'nearby' || userLocation) && cards.length === 0 ? <div className="text-sm text-slate-500">{hasSearchQuery ? label.searchNoData : label.noData}</div> : null}
      {!showNearbyLocationCta ? (
        <>
          <div className="space-y-3">
            {cards.map((card, index) => {
              const swatchColor = card.color || '#ec4899'
              const prioritizeCardCover = index < 20
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => openBangumi(card.id).catch(() => null)}
                  className={`group w-full overflow-hidden rounded-2xl border text-left transition ${
                    selectedBangumiId === card.id
                      ? 'border-brand-400 bg-brand-50/70 shadow-[0_8px_22px_rgba(236,72,153,0.18)]'
                      : 'border-slate-200 bg-white hover:border-brand-200 hover:bg-brand-50/30'
                  }`}
                  onMouseEnter={() => handleCardPointerEnter(card.id)}
                  onMouseLeave={handleCardPointerLeave}
                  onTouchStart={() => handleCardPointerEnter(card.id)}
                >
                  <div className="h-1 w-full" style={{ background: swatchColor, opacity: selectedBangumiId === card.id ? 0.95 : 0.58 }} />
                  <div className="flex items-start gap-3 p-3">
                    <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                      {card.cover ? (
                        <img
                          src={card.cover}
                          alt={card.title}
                          width={96}
                          height={128}
                          className="h-full w-full object-cover"
                          loading={prioritizeCardCover ? 'eager' : 'lazy'}
                          fetchPriority={index < 4 ? 'high' : 'auto'}
                          decoding="async"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center bg-slate-200 text-sm font-semibold text-slate-600">{card.title.slice(0, 1)}</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{card.title}</h3>
                        {card.cat ? <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">{card.cat}</span> : null}
                      </div>
                      {card.titleZh && card.titleZh !== card.title ? <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{card.titleZh}</div> : null}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                        {card.city ? <span className="rounded-full bg-slate-100 px-2 py-0.5">{card.city}</span> : null}
                        {card.nearestDistanceMeters != null ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{formatDistance(card.nearestDistanceMeters)}</span> : null}
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">{card.pointsLength} {label.points}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">{card.imagesLength} {label.screenshots}</span>
                      </div>
                    </div>
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-white shadow-sm" style={{ background: swatchColor }} />
                  </div>
                </button>
              )
            })}
          </div>
          <div ref={cardsLoadMoreRef} className="h-2" />
          {loadingMoreCards ? <div className="pt-3 text-center text-xs text-slate-500">{label.loadingMore}</div> : null}
          {cardsLoadError ? (
            <div className="flex items-center justify-center gap-2 pt-3 text-xs text-rose-600">
              <span>{cardsLoadError}</span>
              <button
                type="button"
                onClick={() => loadMoreCards().catch(() => null)}
                className="rounded border border-rose-200 bg-white px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
              >
                {label.retry}
              </button>
            </div>
          ) : null}
          {!loading && !loadingMoreCards && !hasMoreCards && cards.length > 0 ? (
            <div className="pt-3 text-center text-xs text-slate-400">{label.loadedAll}</div>
          ) : null}
        </>
      ) : null}
    </>
  )

  const mobilePointPopup = !isDesktop && !mobilePanelOpen && mobilePointPopupOpen && selectedPoint ? (
    <div className="pointer-events-none absolute inset-x-3 z-30" style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}>
      <div className="pointer-events-auto mx-auto max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label.pointDetail}</div>
            <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{selectedPoint.name}</h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
              onClick={switchToBangumiDetail}
            >
              {label.backToWorkDetail}
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
              onClick={() => setMobilePointPopupOpen(false)}
            >
              {label.close}
            </button>
          </div>
        </div>
        <div className="space-y-2 px-3 py-3">
          {renderPointImage(selectedPointImage.previewUrl, selectedPoint.name, selectedPointImage.downloadUrl, true)}
          <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
            {selectedPoint.ep ? <span>EP {selectedPoint.ep}</span> : null}
            {selectedPoint.s ? <span>· {selectedPoint.s}</span> : null}
            {selectedPoint.origin ? <span>· {selectedPoint.origin}</span> : null}
            {selectedPointDistanceMeters != null ? <span>· ~{formatDistance(selectedPointDistanceMeters)}</span> : null}
          </div>
          {selectedPoint.note ? (
            <div className="rounded-md bg-slate-50 px-2 py-1 text-xs leading-relaxed text-slate-700">
              {selectedPoint.note}
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
            <div className="text-[11px] text-slate-600">{label.stateAutoHint}</div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              {(['want_to_go', 'planned', 'checked_in'] as const).map((state) => (
                <span
                  key={state}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    selectedPointState === state
                      ? state === 'checked_in'
                        ? 'bg-green-500 text-white'
                        : state === 'planned'
                          ? 'bg-orange-500 text-white'
                          : 'bg-blue-500 text-white'
                      : 'bg-white text-slate-500 ring-1 ring-slate-200'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {state === 'checked_in' ? label.checkedIn : state === 'planned' ? label.planned : label.wantToGo}
                </span>
              ))}
            </div>
            {selectedPointState === 'want_to_go' ? (
              <div className="mt-2 text-[11px] text-blue-600">{label.pointAlreadyInPoolHint}</div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {geoLink(selectedPoint) ? (
              <a className="inline-flex min-w-[92px] items-center justify-center rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white no-underline hover:bg-slate-700" href={geoLink(selectedPoint) || '#'} target="_blank" rel="noreferrer">
                {label.openInGoogle}
              </a>
            ) : null}
            <button
              type="button"
              className="inline-flex min-w-[92px] items-center justify-center rounded bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-55"
              onClick={enterPanorama}
              disabled={!selectedPointPanorama}
              title={selectedPointPanorama ? undefined : label.panoramaUnavailable}
            >
              {label.enterPanorama}
            </button>
            {showWantToGoAction ? (
              <button
                type="button"
                className="inline-flex min-w-[108px] items-center justify-center rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                onClick={() => {
                  addPointToPointPool(selectedPoint.id).catch(() => null)
                }}
              >
                {label.addToPointPool}
              </button>
            ) : null}
            {meState?.pointStates.find((ps) => ps.pointId === selectedPoint.id && ps.state === 'checked_in') && (
              <button
                type="button"
                className="inline-flex min-w-[92px] items-center justify-center rounded border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
                onClick={() => setShowCheckInCard(true)}
              >
                打卡卡片
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div data-layout-wide="true" className="relative h-[calc(100dvh-84px)] w-full overflow-hidden bg-slate-50">
      {warmupBlocking ? (
        <div className="pointer-events-none absolute left-4 top-[max(76px,env(safe-area-inset-top,0px)+52px)] z-40 w-[min(420px,calc(100%-1.25rem))]">
          <div className="cursor-progress">
            <div className="rounded-2xl border border-slate-200/80 bg-white/88 px-3 py-2 shadow-lg backdrop-blur-md">
              <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-700">
                <span>{label.preloadWait}</span>
                <span>{Math.round(warmupProgress.percent)}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200/80">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.min(Math.max(warmupProgress.percent, 0), 100)}%` }}
                />
              </div>
              <div className="mt-1.5 line-clamp-1 text-[11px] text-slate-600">
                {activeWarmupTask?.progress.detail || warmupProgress.detail || label.loading}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {warmupTaskRows.map((task) => (
                  <div key={task.key} className="rounded-md border border-slate-200/80 bg-white/70 px-1.5 py-1">
                    <div className="flex items-center justify-between gap-1 text-[10px] text-slate-600">
                      <span className="line-clamp-1">{task.title}</span>
                      <span>{Math.round(task.progress.percent)}%</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200/80">
                      <div
                        className="h-full rounded-full bg-brand-500/90 transition-[width] duration-300 ease-out"
                        style={{ width: `${Math.min(Math.max(task.progress.percent, 0), 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] lg:grid-rows-1">
        {isDesktop ? (
          <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-white">
            {explorerHeader}
            <div ref={cardsContainerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
              {cardsList}
            </div>
          </aside>
        ) : null}

        <section className="relative h-full min-h-0">
          <div className="absolute inset-0">
            <div
              ref={mapRootRef}
              className={`absolute inset-0 ${mapViewMode === 'map' ? '' : 'hidden'}`}
            />
            <MapLoadingProgress
              percent={mergedLoadingPercent}
              visible={mergedLoadingVisible}
              title={mergedLoadingTitle}
              detail={mergedLoadingDetail}
              className="pointer-events-none absolute left-4 top-[max(62px,env(safe-area-inset-top,0px)+42px)] z-30 w-[min(320px,calc(100%-1rem))]"
            />
            {mapViewMode === 'map' && (
              <>
                <MapModeToggle mode={mapMode} onModeChange={setMapMode} />
              </>
            )}
            <div
              className={`absolute inset-0 bg-black ${mapViewMode === 'panorama' ? '' : 'hidden'}`}
            >
              {mapViewMode === 'panorama' ? (
                selectedPointPanorama ? (
                  <iframe
                    key={`${selectedPointPanorama.provider}:${selectedPointPanorama.src}`}
                    title={selectedPoint ? `${selectedPoint.name} panorama` : 'panorama'}
                    src={selectedPointPanorama.src}
                    className="h-full w-full border-0"
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                    onLoad={() => {
                      setPanoramaError(null)
                      finishPanoramaProgress()
                    }}
                    onError={() => {
                      setPanoramaError(label.panoramaLoadFailed)
                      failPanoramaProgress()
                    }}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center px-6 text-center text-sm text-white/85">
                    {label.panoramaUnavailable}
                  </div>
                )
              ) : null}
              {mapViewMode === 'panorama' && panoramaLoading ? (
                <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                  <div className="w-64 max-w-[78vw] rounded-2xl border border-white/25 bg-black/55 px-4 py-3 text-center shadow-2xl backdrop-blur-sm">
                    <div className="mb-2 inline-flex items-center rounded-full bg-white/15 px-2 py-1 text-[11px] font-semibold text-white/95">
                      <span>{label.panoramaLoading}</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full border border-white/25 bg-white/15">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 transition-[width] duration-200 ease-out"
                        style={{ width: `${panoramaProgress}%` }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
              {mapViewMode === 'panorama' && panoramaError ? (
                <div className="pointer-events-none absolute inset-x-6 bottom-6 z-20 rounded-md bg-black/60 px-3 py-2 text-center text-xs text-white/90">
                  {panoramaError}
                </div>
              ) : null}
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex items-center justify-between gap-2">
            {mapViewMode === 'panorama' ? (
              <button
                className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-xs text-slate-700 shadow hover:bg-white"
                type="button"
                onClick={exitPanorama}
              >
                {label.exitPanorama}
              </button>
            ) : (
              <div />
            )}
            <div className="pointer-events-auto flex items-center gap-2">
              {mapViewMode === 'map' ? (
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  onClick={onLocate}
                  disabled={locating}
                  title={locating ? label.locating : label.locate}
                  aria-label={locating ? label.locating : label.locate}
                >
                  {locating ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m12.5 0a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ) : null}
              <button className="rounded-md bg-white/90 px-3 py-1.5 text-xs text-slate-700 shadow hover:bg-white" type="button" onClick={onShare}>
                {label.share}
              </button>
            </div>
          </div>
          {locateHint ? (
            <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-4">
              <div className="rounded-full bg-black/65 px-3 py-1 text-[11px] text-white shadow-lg backdrop-blur-sm">
                {locateHint}
              </div>
            </div>
          ) : null}

          {mobilePointPopup}

          {!isDesktop ? (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-30 flex justify-center mobile-safe-bottom">
              <button
                type="button"
                onClick={() => setMobilePanelOpen(true)}
                className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 text-sm font-medium text-slate-700 shadow-lg backdrop-blur hover:bg-white"
              >
                <span>
                  {detailCardMode === 'point' && selectedPoint
                    ? `${label.pointDetail} · ${selectedPoint.name}`
                    : detail
                      ? `${label.workDetail} · ${detail.card.title}`
                      : label.openPanel}
                </span>
              </button>
            </div>
          ) : null}

          {isDesktop && detailPanelInner ? (
            <div className="absolute right-4 top-14 z-20 max-h-[calc(100%-80px)] w-[340px] overflow-x-hidden overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
              {detailPanelInner}
            </div>
          ) : null}
        </section>
      </div>

      {!isDesktop ? (
        <Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
          <SheetContent side="bottom" hideClose className="h-[84dvh] rounded-t-2xl border border-slate-200 bg-white p-0">
            <SheetTitle className="sr-only">{label.panel}</SheetTitle>
            <SheetDescription className="sr-only">
              {locale === 'en'
                ? 'Browse filters, title list, and point details'
                : locale === 'ja'
                  ? '絞り込み、作品一覧、スポット詳細を表示'
                  : '浏览筛选、作品列表与地标详情'}
            </SheetDescription>
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-slate-200 px-4 py-3">
                <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-300" />
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">{label.panel}</h2>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    onClick={() => setMobilePanelOpen(false)}
                  >
                    {label.hidePanel}
                  </button>
                </div>
              </div>

              {explorerHeader}

              <div ref={cardsContainerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                {cardsList}
                {detailPanelInner ? (
                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    {detailPanelInner}
                  </div>
                ) : null}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {showQuickPilgrimage && detail ? (
        <QuickPilgrimageMode
          bangumi={detail}
          userPointStates={quickPilgrimageStates}
          onClose={() => setShowQuickPilgrimage(false)}
          onStatesUpdated={() => {
            loadMe().catch(() => null)
          }}
        />
      ) : null}

      <Dialog.Root open={routeBookPickerOpen} onOpenChange={setRouteBookPickerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl focus:outline-none">
            <Dialog.Title className="text-sm font-semibold text-slate-900">{label.routeBookSelectTitle}</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-slate-500">{label.routeBookPickOne}</Dialog.Description>

            {routeBookPickerLoading ? (
              <div className="mt-4 text-sm text-slate-500">{label.routeBookLoading}</div>
            ) : (
              <div className="mt-3 space-y-2">
                {routeBookItems.length > 0 ? (
                  <div className="max-h-44 space-y-2 overflow-y-auto">
                    {routeBookItems.map((book) => (
                      <button
                        key={book.id}
                        type="button"
                        disabled={routeBookPickerSaving}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => {
                          void addSelectedPointToRouteBook(book.id)
                        }}
                      >
                        <span className="truncate">{book.title}</span>
                        <span className="ml-2 text-xs text-slate-400">{book.status}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{label.routeBookEmpty}</div>
                )}
              </div>
            )}

            <div className="mt-4 space-y-2">
              <input
                type="text"
                value={routeBookTitleDraft}
                onChange={(e) => setRouteBookTitleDraft(e.target.value)}
                placeholder={label.routeBookCreatePlaceholder}
                maxLength={100}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                disabled={routeBookPickerSaving || !routeBookTitleDraft.trim()}
                className="w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  void createRouteBookAndAddPoint()
                }}
              >
                {routeBookPickerSaving ? label.loading : label.routeBookCreateAndAdd}
              </button>
            </div>

            {routeBookPickerError ? (
              <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{routeBookPickerError}</div>
            ) : null}

            <div className="mt-4 flex justify-end">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                >
                  {label.close}
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(imagePreview)} onOpenChange={onImagePreviewOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[121] min-w-[320px] max-w-[92vw] w-fit -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl focus:outline-none sm:p-4">
            <Dialog.Description className="sr-only">
              {locale === 'en' ? 'Image preview with manual save action' : locale === 'ja' ? '画像プレビューと手动保存操作' : '图片预览与手动保存'}
            </Dialog.Description>
            <div className="mb-3 flex items-center justify-between gap-2">
              <Dialog.Title className="line-clamp-1 text-sm font-semibold text-slate-900">
                {imagePreview?.name || label.previewImage}
              </Dialog.Title>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowComparisonGenerator(true)}
                  className="rounded border border-brand-300 bg-brand-50 px-2 py-1 text-xs text-brand-700 hover:bg-brand-100"
                >
                  制作对比图
                </button>
                {imagePreview?.saveUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      saveOriginalImage().catch(() => null)
                    }}
                    disabled={imageSaving}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 no-underline hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {imageSaving ? label.savingOriginal : label.saveOriginal}
                  </button>
                ) : null}
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    {label.close}
                  </button>
                </Dialog.Close>
              </div>
            </div>
            {imageSaveError ? (
              <div className="mb-2 text-xs text-rose-600">{imageSaveError}</div>
            ) : null}
            {imagePreview?.src ? (
              <div className="max-h-[78dvh] overflow-auto rounded-lg bg-slate-100 p-1 sm:p-2">
                <img
                  src={imagePreview.src}
                  alt={imagePreview.name || label.previewImage}
                  className="mx-auto block h-auto max-h-[72dvh] w-auto max-w-[88vw] object-contain"
                />
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={showCheckInCard} onOpenChange={setShowCheckInCard}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none">
            <CheckInCard
              animeTitle={detail?.card.title || ''}
              pointName={selectedPoint?.name || ''}
              cityName={detail?.card.city || ''}
              imageUrl={comparisonImageUrl || selectedPointImage.previewUrl || ''}
              shareUrl={typeof window !== 'undefined' ? window.location.href : ''}
              onClose={() => setShowCheckInCard(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={showRouteBookCard} onOpenChange={setShowRouteBookCard}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none">
            <RouteBookCard
              animeTitle={detail?.card.titleZh || detail?.card.title || ''}
              routeBookTitle={`${detail?.card.city || ''}圣地巡礼`}
              cityName={detail?.card.city || ''}
              totalPoints={detail?.points.length || 0}
              totalDistance={totalRouteDistance}
              completionDate={new Date().toLocaleDateString('zh-CN')}
              points={(detail?.points || [])
                .filter((p): p is typeof p & { geo: [number, number] } => isValidGeoPair(p.geo))
                .map(p => ({ lat: p.geo[0], lng: p.geo[1] }))}
              featuredImages={checkedInThumbnails}
              shareUrl={typeof window !== 'undefined' ? window.location.href : ''}
              onClose={() => setShowRouteBookCard(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={showComparisonGenerator} onOpenChange={setShowComparisonGenerator}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 bottom-0 z-[131] w-full max-w-2xl -translate-x-1/2 focus:outline-none sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2">
            <ComparisonImageGenerator
              animeImage={selectedPointImage.downloadUrl || selectedPointImage.previewUrl || ''}
              animeTitle={detail?.card.title || ''}
              pointName={selectedPoint?.name || ''}
              onClose={() => setShowComparisonGenerator(false)}
              onSuccess={(blob) => {
                setComparisonImageBlob(blob)
                setComparisonImageUrl(URL.createObjectURL(blob))
                setShowComparisonGenerator(false)
                setShowCheckInCard(true)
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Location permission dialog for first-visit users */}
      <Dialog.Root open={locationDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setLocationDialogOpen(false)
          try {
            window.sessionStorage.setItem(LOCATION_DIALOG_DISMISSED_KEY, '1')
          } catch {
            // sessionStorage unavailable
          }
        }
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-black/30 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-brand-100 bg-brand-50 p-5 shadow-2xl focus:outline-none">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-100">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-brand-600">
                <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </div>
            <Dialog.Title className="text-base font-semibold text-slate-900">{label.locationDialogTitle}</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-sm text-slate-600">{label.locationDialogBody}</Dialog.Description>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setLocationDialogOpen(false)
                  try {
                    window.sessionStorage.setItem(LOCATION_DIALOG_DISMISSED_KEY, '1')
                  } catch {
                    // sessionStorage unavailable
                  }
                }}
              >
                {label.locationDialogSkip}
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                onClick={() => {
                  setLocationDialogOpen(false)
                  locateUser()
                  setTab('nearby')
                }}
              >
                {label.locationDialogGrant}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
