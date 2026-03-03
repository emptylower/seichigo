'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import maplibregl from 'maplibre-gl'
import type { SupportedLocale } from '@/lib/i18n/types'
import type {
  AnitabiBangumiCard,
  AnitabiBangumiDTO,
  AnitabiBootstrapDTO,
  AnitabiMapTab,
  AnitabiPreloadChunkItemDTO,
  AnitabiPreloadManifestDTO,
} from '@/lib/anitabi/types'
import { extractLatLngFromGoogleMapsUrl } from '@/lib/route/google'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import CheckInCard from '@/components/share/CheckInCard'
import RouteBookCard from '@/components/share/RouteBookCard'
import ComparisonImageGenerator from '@/components/comparison/ComparisonImageGenerator'
import QuickPilgrimageMode from '@/components/quickPilgrimage/QuickPilgrimageMode'
import MapLoadingProgress from './MapLoadingProgress'
import { createCacheStore } from '@/lib/anitabi/client/clientCache'
import type { CacheStore } from '@/lib/anitabi/client/types'
import { isValidTheme } from './types'
import type { AnitabiTheme } from './types'
import { createGlobalFeatureCollection } from './utils/globalFeatureCollection'
import type { InputPoint } from './utils/globalFeatureCollection'
import { cutSpriteSheet } from './utils/spriteRenderer'
import type { ImageLoader } from './utils/spriteRenderer'
import { CoverAvatarLoader } from './utils/coverAvatarLoader'
import { toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'
import {
  COMPLETE_BANGUMI_COVERS_LAYER_ID,
  COMPLETE_DOTS_LAYER_ID,
  COMPLETE_ICONS_LAYER_ID,
  ensureCompleteModeSources,
  ensureCompleteModeSymbolLayer,
  updateCompleteModeSources,
  updateCompleteModeCoverSource,
  removeCompleteModeLayers,
  ensureLabelLayer,
  updateLabelSource,
  removeLabelLayer,
  buildLabelFeatureCollection,
} from './CompleteModeLayers'
import { MapModeToggle } from './MapModeToggle'
import { useMapMode } from './hooks/useMapMode'

// --- Client-side FIFO cache for bangumi detail (max 30 entries) ---
const BANGUMI_CACHE_MAX = 30
const bangumiDetailCache = new Map<number, AnitabiBangumiDTO>()
function cachePut(id: number, data: AnitabiBangumiDTO) {
  if (bangumiDetailCache.size >= BANGUMI_CACHE_MAX && !bangumiDetailCache.has(id)) {
    const oldest = bangumiDetailCache.keys().next().value as number
    bangumiDetailCache.delete(oldest)
  }
  bangumiDetailCache.set(id, data)
}
// AbortController for in-flight prefetch
let prefetchAbort: AbortController | null = null
const POINT_IMAGE_PREFETCH_LIMIT = 24
const POINT_IMAGE_PREFETCH_CACHE_MAX = 2400
const prefetchedPointImageUrls = new Set<string>()
const prefetchingPointImageUrls = new Set<string>()
const NON_NEARBY_TABS: Array<Exclude<AnitabiMapTab, 'nearby'>> = ['latest', 'recent', 'hot']
const WARMUP_BLOCKING_BUDGET_MS = 40000
const PRELOAD_CHUNK_CONCURRENCY = 3
const PRELOAD_IMAGE_BLOCKING_MAX = 280
const PRELOAD_IMAGE_BACKGROUND_MAX = 2200
const PRELOAD_IMAGE_BLOCKING_BASE_CONCURRENCY = 6
const PRELOAD_IMAGE_BACKGROUND_CONCURRENCY = 4
const WARMUP_IMAGE_TIMEOUT_MS = 1800
const WARMUP_ACTIVE_DETAIL_IMAGE_MAX = 120
const WARMUP_MAP_WAIT_TIMEOUT_MS = 12000
const WARMUP_MAP_READY_TIMEOUT_MS = 15000
const WARMUP_TASK_WEIGHTS: Record<WarmupTaskKey, number> = {
  map: 20,
  cards: 30,
  details: 35,
  images: 20,
}
const MAP_PRELOAD_V2_ENABLED = String(process.env.NEXT_PUBLIC_MAP_PRELOAD_V2 || '1').trim() !== '0'
const MAP_VECTOR_ENABLED = String(process.env.NEXT_PUBLIC_MAP_VECTOR || '1').trim() !== '0'
const MAPTILER_KEY = String(process.env.NEXT_PUBLIC_MAPTILER_KEY || '').trim()
const MAPBOX_TOKEN = String(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '').trim()
const STADIA_KEY = String(process.env.NEXT_PUBLIC_STADIA_MAPS_API_KEY || '').trim()
const MAP_STYLE_PROVIDER_ORDER = String(process.env.NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER || 'maptiler,mapbox,stadia,raster').trim()
const MAP_STYLE_FAILOVER_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(String(process.env.NEXT_PUBLIC_MAP_STYLE_FAILOVER_TIMEOUT_MS || ''), 10)
  if (!Number.isFinite(parsed)) return 9000
  return Math.max(3000, Math.min(30000, parsed))
})()
const MAP_STYLE_FAILOVER_ERROR_BURST_WINDOW_MS = 2400
const MAP_STYLE_FAILOVER_ERROR_BURST_THRESHOLD = 3

function createEmptyWarmupTaskProgress(): WarmupTaskProgress {
  return {
    map: { percent: 0, detail: '' },
    cards: { percent: 0, detail: '' },
    details: { percent: 0, detail: '' },
    images: { percent: 0, detail: '' },
  }
}

type WarmupProgress = {
  phase: 'idle' | 'loading' | 'done'
  percent: number
  title: string
  detail: string
}

type WarmupTaskKey = 'map' | 'cards' | 'details' | 'images'

type WarmupTaskProgress = Record<WarmupTaskKey, {
  percent: number
  detail: string
}>

type Props = {
  locale: SupportedLocale
  initialBootstrap?: AnitabiBootstrapDTO
}

type PointState = {
  pointId: string
  state: 'want_to_go' | 'planned' | 'checked_in'
}

type MeState = {
  pointStates: PointState[]
}

type UrlState = {
  b: number | null
  p: string | null
  lng: number
  lat: number
  z: number
  hasViewport: boolean
  tab: AnitabiMapTab
  q: string
}

type UserLocation = {
  lat: number
  lng: number
  accuracy: number | null
}

type SearchResult = {
  bangumi: AnitabiBangumiCard[]
  points: Array<{ id: string; bangumiId: number; name: string }>
  cities: string[]
}

type RouteBookStatus = 'draft' | 'in_progress' | 'completed'

type RouteBookListItem = {
  id: string
  title: string
  status: RouteBookStatus
}

const DEFAULT_VIEW = {
  lng: 139.767125,
  lat: 35.681236,
  z: 5,
}
const CARD_PAGE_SIZE = 18
const CARD_LIST_PREFETCH_ROOT_MARGIN = '0px 0px 320px 0px'
const RANGE_SOURCE_ID = 'anitabi-bangumi-range-source'
const RANGE_FILL_LAYER_ID = 'anitabi-bangumi-range-fill'
const RANGE_LINE_LAYER_ID = 'anitabi-bangumi-range-line'
const POINT_SOURCE_ID = 'anitabi-bangumi-point-source'
const POINT_LAYER_ID = 'anitabi-bangumi-point-layer'
const POINT_SELECTED_HALO_LAYER_ID = 'anitabi-bangumi-point-selected-halo-layer'
const POINT_SELECTED_LAYER_ID = 'anitabi-bangumi-point-selected-layer'
const DETAIL_PANEL_WIDTH = 340
const DESKTOP_BREAKPOINT = 1024
const CLUSTER_JOIN_DISTANCE_MIN_METERS = 120000
const CLUSTER_JOIN_DISTANCE_MAX_METERS = 900000
const CLUSTER_JOIN_DISTANCE_SCALE = 8
const PANORAMA_TRIGGER_ZOOM = 18.4
const USER_LOCATION_STORAGE_KEY = 'anitabi-map-user-location'
const POINT_POOL_HINT_SEEN_STORAGE_KEY = 'anitabi-map-point-pool-hint-seen'
const LOCATION_DIALOG_DISMISSED_KEY = 'anitabi-map-location-dialog-dismissed'

type CameraPadding = {
  top: number
  right: number
  bottom: number
  left: number
}

type PointCoord = [number, number]
type PointFeatureProperties = {
  pointId: string
  color: string
  selected: number
  userState: string
}

type PanoramaEmbed = {
  provider: 'google'
  src: string
} | {
  provider: 'mapillary'
  src: string
}

type MapStyleMode = 'street' | 'satellite'
type MapStyleProvider = 'maptiler' | 'mapbox' | 'stadia' | 'raster'
type MapStyleCandidate = {
  provider: MapStyleProvider
  label: string
  style: maplibregl.StyleSpecification | string
}

function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

function resolveLocateZoom(accuracy: number | null): number {
  if (accuracy == null || !Number.isFinite(accuracy)) return 11
  if (accuracy <= 100) return 15
  if (accuracy <= 500) return 13
  return 11
}

function readStoredUserLocation(): UserLocation | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(USER_LOCATION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      lat?: unknown
      lng?: unknown
      accuracy?: unknown
      updatedAt?: unknown
    }
    const lat = typeof parsed.lat === 'number' ? parsed.lat : Number.NaN
    const lng = typeof parsed.lng === 'number' ? parsed.lng : Number.NaN
    if (!isValidLatLng(lat, lng)) return null

    // Check TTL: 5 minutes = 300000ms
    const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
    const age = Date.now() - updatedAt
    if (age > 300000) return null

    const accuracy = typeof parsed.accuracy === 'number' && Number.isFinite(parsed.accuracy)
      ? Math.max(0, Math.round(parsed.accuracy))
      : null
    return { lat, lng, accuracy }
  } catch {
    return null
  }
}

function readStoredUserLocationRaw(): UserLocation | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(USER_LOCATION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      lat?: unknown
      lng?: unknown
      accuracy?: unknown
    }
    const lat = typeof parsed.lat === 'number' ? parsed.lat : Number.NaN
    const lng = typeof parsed.lng === 'number' ? parsed.lng : Number.NaN
    if (!isValidLatLng(lat, lng)) return null
    const accuracy = typeof parsed.accuracy === 'number' && Number.isFinite(parsed.accuracy)
      ? Math.max(0, Math.round(parsed.accuracy))
      : null
    return { lat, lng, accuracy }
  } catch {
    return null
  }
}

function writeStoredUserLocation(location: UserLocation): void {
  if (typeof window === 'undefined') return
  if (!isValidLatLng(location.lat, location.lng)) return
  try {
    window.localStorage.setItem(
      USER_LOCATION_STORAGE_KEY,
      JSON.stringify({
        lat: location.lat,
        lng: location.lng,
        accuracy: location.accuracy,
        updatedAt: Date.now(),
      })
    )
  } catch {
    // noop
  }
}

function hasSeenPointPoolHint(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(POINT_POOL_HINT_SEEN_STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

function markPointPoolHintSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(POINT_POOL_HINT_SEEN_STORAGE_KEY, '1')
  } catch {
    // noop
  }
}

async function queryGeolocationPermissionState(): Promise<PermissionState | null> {
  if (typeof navigator === 'undefined') return null
  const permissions = (navigator as Navigator & { permissions?: Permissions }).permissions
  if (!permissions?.query) return null
  try {
    const status = await permissions.query({ name: 'geolocation' as PermissionName })
    return status.state
  } catch {
    return null
  }
}

function parseNumberParam(value: string | null): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function isRouteBookListItem(value: unknown): value is RouteBookListItem {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.title === 'string' &&
    (row.status === 'draft' || row.status === 'in_progress' || row.status === 'completed')
  )
}

function getApiErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return typeof row.error === 'string' ? row.error : null
}

function getRouteBookIdFromCreateResponse(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const routeBook = row.routeBook
  if (routeBook && typeof routeBook === 'object' && typeof (routeBook as { id?: unknown }).id === 'string') {
    return (routeBook as { id: string }).id
  }
  const item = row.item
  if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
    return (item as { id: string }).id
  }
  return null
}

function normalizeSearchKeyword(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

function filterBulkCardsBySearch(
  cards: AnitabiBangumiCard[],
  query: string,
  selectedCity: string,
  searchResult: SearchResult | null
): AnitabiBangumiCard[] {
  const byCity = selectedCity
    ? cards.filter((card) => card.city === selectedCity)
    : cards

  const normalizedQuery = normalizeSearchKeyword(query)
  if (!normalizedQuery) return byCity

  if (searchResult) {
    const matchedBangumiIds = new Set<number>()
    for (const item of searchResult.bangumi) {
      matchedBangumiIds.add(item.id)
    }
    for (const point of searchResult.points) {
      matchedBangumiIds.add(point.bangumiId)
    }

    const matchedCities = new Set(
      searchResult.cities
        .map((city) => String(city).trim())
        .filter((city) => city.length > 0)
    )

    if (matchedBangumiIds.size > 0 || matchedCities.size > 0) {
      return byCity.filter((card) => {
        if (matchedBangumiIds.has(card.id)) return true
        const city = String(card.city || '').trim()
        return city ? matchedCities.has(city) : false
      })
    }
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  return byCity.filter((card) => {
    const haystack = normalizeSearchKeyword([card.title, card.titleZh, card.city, card.cat].filter(Boolean).join(' '))
    return tokens.every((token) => haystack.includes(token))
  })
}

const L: Record<SupportedLocale, Record<string, string>> = {
  zh: {
    title: '巡礼地图',
    searchPlaceholder: '城市、作品、地标',
    latest: '最新更新',
    recent: '近期新作',
    hot: '热门作品',
    nearby: '附近的点位',
    random: '随机跳转作品',
    locate: '定位到我的位置',
    locating: '定位中…',
    located: '已定位',
    locateDenied: '定位权限被拒绝，请在浏览器中允许位置权限',
    locateTimeout: '定位超时，请重试',
    locateUnavailable: '当前设备不支持定位',
    locateInsecure: '定位需要 HTTPS 或 localhost 环境',
    locateFailed: '定位失败，请稍后重试',
    mapNotReady: '地图尚未就绪，请稍后再试',
    nearbyNeedLocation: '请先允许定位，以查看附近作品',
    nearbyGrantLocation: '授权定位',
    close: '关闭',
    loading: '加载中...',
    loadingMore: '正在加载更多作品…',
    loadedAll: '已加载全部作品',
    loadMoreFailed: '加载更多失败，请重试',
    preloadTitle: '正在预加载地图数据',
    preloadMap: '地图底图',
    preloadMapPreparing: '初始化地图底图',
    preloadMapTiles: '等待地图底图可用',
    preloadMapDone: '地图底图就绪',
    preloadCards: '四板块卡片',
    preloadDetails: '点位分块',
    preloadImages: '图片预热',
    preloadDone: '预加载完成',
    preloadWait: '地图数据加载中，请耐心等待…',
    retry: '重试',
    noData: '暂无可用数据',
    searchNoData: '未找到匹配作品，试试更换关键词，或清空搜索查看附近点位',
    points: '地标',
    screenshots: '截图',
    share: '分享',
    shareCopied: '分享链接已复制',
    shareFailed: '分享失败，请手动复制地址栏链接',
    shareManualCopy: '复制以下链接',
    openInGoogle: '谷歌导航',
    enterPanorama: '进入全景',
    exitPanorama: '退出全景',
    panoramaLoading: '少女祈祷中',
    panoramaUnavailable: '该点位暂无可用全景',
    panoramaLoadFailed: '全景加载失败，请稍后重试',
    noImage: '暂无图片',
    previewImage: '预览原图',
    saveOriginal: '下载原图',
    savingOriginal: '下载中…',
    saveOriginalFailed: '下载失败，请重试',
    favorites: '收藏',
    favoriteAdded: '已加入收藏',
    favoriteRemoved: '已取消收藏',
    favoriteFailed: '收藏失败，请稍后重试',
    selected: '当前作品',
    workDetail: '作品详情',
    pointDetail: '点位详情',
    backToWorkDetail: '返回作品详情',
    signInToFavorite: '登录后可收藏',
    signInToPointPool: '登录后可将点位加入我的地图',
    signInToRouteBook: '登录后可使用我的地图',
    quickStart: '开始',
    quickPilgrimage: '快速巡礼',
    quickPilgrimageHint: '站内逐点导航推进，可选打开 Google Maps',
    quickPilgrimageProgressPrefix: '已打卡',
    routeBooks: '我的地图',
    addToRouteBook: '加入我的地图',
    addToRouteBookSuccess: '已加入我的地图',
    addToRouteBookFailed: '加入我的地图失败，请稍后重试',
    addToPointPool: '加入我的地图',
    addToPointPoolSuccess: '已加入我的地图',
    addToPointPoolFailed: '加入我的地图失败，请稍后重试',
    pointPoolGuide: '已加入我的地图：你可在「我的地图」中继续规划路线。',
    stateAutoHint: '状态由行为自动更新：想去 -> 规划中 -> 打卡后已打卡',
    pointAlreadyInPoolHint: '已在我的地图中。',
    routeBookSelectTitle: '加入我的地图',
    routeBookLoading: '正在加载我的地图…',
    routeBookEmpty: '你还没有地图，先创建一个吧',
    routeBookPickOne: '选择一个地图',
    routeBookCreatePlaceholder: '例如：东京圣地巡礼地图',
    routeBookCreateAndAdd: '新建并加入',
    routeBookCreatedAndAdded: '地图创建成功并已加入点位',
    wantToGo: '想去',
    planned: '规划中',
    checkedIn: '已打卡',
    street: '街道',
    satellite: '卫星',
    search: '搜索',
    allCities: '全部',
    searchCityPrefix: '城市',
    searchAnimePrefix: '作品',
    searchPointPrefix: '地标',
    openPanel: '打开列表面板',
    hidePanel: '收起面板',
    panel: '作品与筛选',
    allPoints: '全部圣地',
    onlyMarked: '只看我的标记',
    expandWorkDetail: '展开',
    collapseWorkDetail: '收起',
    locationDialogTitle: '发现附近的巡礼地点',
    locationDialogBody: '授予位置权限可以查看你附近的巡礼地点和作品哦',
    locationDialogGrant: '授予位置权限',
    locationDialogSkip: '暂不需要',
  },
  en: {
    title: 'Pilgrimage Map',
    searchPlaceholder: 'City, anime, or spot',
    latest: 'Latest Updates',
    recent: 'Recent Releases',
    hot: 'Trending',
    nearby: 'Nearby Works',
    random: 'Random Anime',
    locate: 'Locate Me',
    locating: 'Locating…',
    located: 'Located',
    locateDenied: 'Location permission denied in browser settings',
    locateTimeout: 'Location timeout, please retry',
    locateUnavailable: 'Geolocation is unavailable on this device',
    locateInsecure: 'Geolocation requires HTTPS or localhost',
    locateFailed: 'Failed to locate, please retry later',
    mapNotReady: 'Map is not ready yet',
    nearbyNeedLocation: 'Allow location access to view nearby works',
    nearbyGrantLocation: 'Enable location',
    close: 'Close',
    loading: 'Loading...',
    loadingMore: 'Loading more titles…',
    loadedAll: 'All titles loaded',
    loadMoreFailed: 'Failed to load more titles',
    preloadTitle: 'Preloading map data',
    preloadMap: 'Map Base Layer',
    preloadMapPreparing: 'Preparing map base',
    preloadMapTiles: 'Waiting for base map',
    preloadMapDone: 'Map base ready',
    preloadCards: 'Four Tab Cards',
    preloadDetails: 'Point Chunks',
    preloadImages: 'Image Warmup',
    preloadDone: 'Preload complete',
    preloadWait: 'Map data is loading, please wait…',
    retry: 'Retry',
    noData: 'No data yet',
    searchNoData: 'No matches found. Try another keyword, or clear search to see nearby works.',
    points: 'Points',
    screenshots: 'Shots',
    share: 'Share',
    shareCopied: 'Share link copied',
    shareFailed: 'Share failed, please copy the URL from the address bar',
    shareManualCopy: 'Copy this link',
    openInGoogle: 'Google Nav',
    enterPanorama: 'Enter Panorama',
    exitPanorama: 'Exit Panorama',
    panoramaLoading: 'Loading panorama…',
    panoramaUnavailable: 'Panorama is unavailable for this point',
    panoramaLoadFailed: 'Failed to load panorama, please retry',
    noImage: 'No image yet',
    previewImage: 'Preview image',
    saveOriginal: 'Download original',
    savingOriginal: 'Downloading…',
    saveOriginalFailed: 'Download failed, please retry',
    favorites: 'Favorite',
    favoriteAdded: 'Added to favorites',
    favoriteRemoved: 'Removed from favorites',
    favoriteFailed: 'Failed to update favorite',
    selected: 'Selected',
    workDetail: 'Work Detail',
    pointDetail: 'Point Detail',
    backToWorkDetail: 'Back to Work',
    signInToFavorite: 'Sign in to favorite',
    signInToPointPool: 'Sign in to add this point to My Map',
    signInToRouteBook: 'Sign in to use My Maps',
    quickStart: 'Start',
    quickPilgrimage: 'Quick Pilgrimage',
    quickPilgrimageHint: 'In-page step navigation with optional Google Maps handoff',
    quickPilgrimageProgressPrefix: 'Checked in',
    routeBooks: 'My Maps',
    addToRouteBook: 'Add to My Map',
    addToRouteBookSuccess: 'Added to My Map',
    addToRouteBookFailed: 'Failed to add to My Map',
    addToPointPool: 'Add to My Map',
    addToPointPoolSuccess: 'Added to My Map',
    addToPointPoolFailed: 'Failed to add to My Map',
    pointPoolGuide: 'Added to My Map. You can continue planning in My Maps.',
    stateAutoHint: 'State is automatic: Want to go -> Planning -> Checked in after check-in.',
    pointAlreadyInPoolHint: 'Already in My Map.',
    routeBookSelectTitle: 'Add to My Map',
    routeBookLoading: 'Loading My Maps…',
    routeBookEmpty: 'No maps yet. Create one first.',
    routeBookPickOne: 'Pick a map',
    routeBookCreatePlaceholder: 'For example: Tokyo pilgrimage map',
    routeBookCreateAndAdd: 'Create & Add',
    routeBookCreatedAndAdded: 'Map created and point added',
    wantToGo: 'Want to go',
    planned: 'Planning',
    checkedIn: 'Checked in',
    street: 'Street',
    satellite: 'Satellite',
    search: 'Search',
    allCities: 'All',
    searchCityPrefix: 'City',
    searchAnimePrefix: 'Anime',
    searchPointPrefix: 'Spot',
    openPanel: 'Open list panel',
    hidePanel: 'Hide panel',
    panel: 'Titles & filters',
    allPoints: 'All Spots',
    onlyMarked: 'My Markers',
    expandWorkDetail: 'Show more',
    collapseWorkDetail: 'Show less',
    locationDialogTitle: 'Discover Nearby Spots',
    locationDialogBody: 'Grant location access to find pilgrimage spots near you',
    locationDialogGrant: 'Enable Location',
    locationDialogSkip: 'Not Now',
  },
  ja: {
    title: '巡礼マップ',
    searchPlaceholder: '都市・作品・スポット',
    latest: '最新更新',
    recent: '新着作品',
    hot: '人気作品',
    nearby: '近くの作品',
    random: 'ランダム作品',
    locate: '現在地',
    locating: '現在地を取得中…',
    located: '現在地を取得済み',
    locateDenied: '位置情報の权限が拒否されました。ブラウザ設定をご確認ください',
    locateTimeout: '位置情報の取得がタイムアウトしました',
    locateUnavailable: 'この端末では位置情報を利用できません',
    locateInsecure: '位置情報には HTTPS または localhost が必要です',
    locateFailed: '位置情報の取得に失敗しました',
    mapNotReady: '地図の初期化が未完了です',
    nearbyNeedLocation: '近くの作品を見るには位置情報を許可してください',
    nearbyGrantLocation: '位置情報を許可',
    close: '閉じる',
    loading: '読み込み中...',
    loadingMore: '作品をさらに読み込み中…',
    loadedAll: 'すべての作品を読み込みました',
    loadMoreFailed: '追加読み込みに失敗しました',
    preloadTitle: '地図データを事前読み込み中',
    preloadMap: '地図ベース',
    preloadMapPreparing: '地図ベースを初期化',
    preloadMapTiles: '地図ベースの準備待ち',
    preloadMapDone: '地図ベース準備完了',
    preloadCards: '4タブ作品カード',
    preloadDetails: 'スポット分割データ',
    preloadImages: '画像ウォームアップ',
    preloadDone: '事前読み込み完了',
    preloadWait: '地図データを読み込み中です。しばらくお待ちください…',
    retry: '再試行',
    noData: 'データがありません',
    searchNoData: '一致する作品が見つかりません。キーワードを変更するか、検索をクリアして近くの作品を表示してください',
    points: 'スポット',
    screenshots: '画像',
    share: '共有',
    shareCopied: '共有リンクをコピーしました',
    shareFailed: '共有に失敗しました。アドレスバーの URL を手動でコピーしてください',
    shareManualCopy: 'このリンクをコピー',
    openInGoogle: 'Google ナビ',
    enterPanorama: '全景を表示',
    exitPanorama: '全景を閉じる',
    panoramaLoading: '全景を読み込み中…',
    panoramaUnavailable: 'このスポットでは全景を利用できません',
    panoramaLoadFailed: '全景の読み込みに失敗しました',
    noImage: '画像はありません',
    previewImage: '原画像を表示',
    saveOriginal: '元画像をダウンロード',
    savingOriginal: 'ダウンロード中…',
    saveOriginalFailed: 'ダウンロードに失敗しました',
    favorites: 'お気に入り',
    favoriteAdded: 'お気に入りに追加しました',
    favoriteRemoved: 'お気に入りを解除しました',
    favoriteFailed: 'お気に入りの更新に失敗しました',
    selected: '選択中',
    workDetail: '作品詳細',
    pointDetail: 'スポット詳細',
    backToWorkDetail: '作品詳細へ戻る',
    signInToFavorite: 'ログインしてお気に入り',
    signInToPointPool: 'ログインしてマイマップに追加',
    signInToRouteBook: 'マイマップ機能を使うにはログインしてください',
    quickStart: '開始',
    quickPilgrimage: 'クイック巡礼',
    quickPilgrimageHint: 'ページ内で順番に進行し、必要時のみ Google Maps を開けます',
    quickPilgrimageProgressPrefix: '巡礼済み',
    routeBooks: 'マイマップ',
    addToRouteBook: 'マイマップに追加',
    addToRouteBookSuccess: 'マイマップに追加しました',
    addToRouteBookFailed: 'マイマップへの追加に失敗しました',
    addToPointPool: 'マイマップに追加',
    addToPointPoolSuccess: 'マイマップに追加しました',
    addToPointPoolFailed: 'マイマップへの追加に失敗しました',
    pointPoolGuide: 'マイマップに追加しました。マイマップでルート計画を続けられます。',
    stateAutoHint: '状態は自動更新です：行きたい -> 計画中 -> 打刻で巡礼済み',
    pointAlreadyInPoolHint: 'すでにマイマップにあります。',
    routeBookSelectTitle: 'マイマップに追加',
    routeBookLoading: 'マイマップを読み込み中…',
    routeBookEmpty: 'マイマップがありません。先に作成してください。',
    routeBookPickOne: 'マップを選択',
    routeBookCreatePlaceholder: '例：東京聖地巡礼マップ',
    routeBookCreateAndAdd: '作成して追加',
    routeBookCreatedAndAdded: 'マップを作成し、スポットを追加しました',
    wantToGo: '行きたい',
    planned: '計画中',
    checkedIn: '巡礼済み',
    street: '街道',
    satellite: '衛星',
    search: '検索',
    allCities: 'すべて',
    searchCityPrefix: '都市',
    searchAnimePrefix: '作品',
    searchPointPrefix: 'スポット',
    openPanel: 'リストを開く',
    hidePanel: 'パネルを閉じる',
    panel: '作品と絞り込み',
    allPoints: 'すべてのスポット',
    onlyMarked: 'マイマーク',
    expandWorkDetail: 'もっと見る',
    collapseWorkDetail: '折りたたむ',
    locationDialogTitle: '近くのスポットを見つけよう',
    locationDialogBody: '位置情報を許可すると近くの巡礼スポットが見られます',
    locationDialogGrant: '位置情報を許可',
    locationDialogSkip: '今はしない',
  },
}

function parseUrlState(): UrlState {
  if (typeof window === 'undefined') {
    return {
      b: null,
      p: null,
      lng: DEFAULT_VIEW.lng,
      lat: DEFAULT_VIEW.lat,
      z: DEFAULT_VIEW.z,
      hasViewport: false,
      tab: 'latest',
      q: '',
    }
  }

  const params = new URLSearchParams(window.location.search)
  const b = parseNumberParam(params.get('b'))
  const lng = parseNumberParam(params.get('mlng')) ?? parseNumberParam(params.get('lng'))
  const lat = parseNumberParam(params.get('lat'))
  const z = parseNumberParam(params.get('z'))
  const tabRaw = params.get('tab')

  return {
    b: b && b > 0 ? b : null,
    p: params.get('p') || null,
    lng: lng ?? DEFAULT_VIEW.lng,
    lat: lat ?? DEFAULT_VIEW.lat,
    z: z && z > 0 ? z : DEFAULT_VIEW.z,
    hasViewport: lng != null || lat != null || z != null,
    tab: tabRaw === 'latest' || tabRaw === 'recent' || tabRaw === 'hot' || tabRaw === 'nearby' ? tabRaw : 'latest',
    q: params.get('q') || '',
  }
}

function sanitizeDownloadFileNameBase(input: string): string {
  const cleaned = String(input || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'anitabi-image'
  return cleaned.slice(0, 80)
}

function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null

  const utf8Match = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      const decoded = decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''))
      if (decoded) return decoded
    } catch {
      // noop
    }
  }

  const plainMatch = value.match(/filename\s*=\s*"?([^";]+)"?/i)
  if (plainMatch?.[1]) {
    const name = plainMatch[1].trim()
    if (name) return name
  }

  return null
}

function extensionFromMimeType(mimeType: string | null | undefined): string {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized.includes('image/jpeg') || normalized.includes('image/jpg')) return '.jpg'
  if (normalized.includes('image/png')) return '.png'
  if (normalized.includes('image/webp')) return '.webp'
  if (normalized.includes('image/avif')) return '.avif'
  if (normalized.includes('image/gif')) return '.gif'
  if (normalized.includes('image/svg+xml')) return '.svg'
  return '.jpg'
}

function normalizePointImageUrl(input: string | null | undefined): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null

  try {
    const url = new URL(raw, 'https://seichigo.com')
    const host = url.hostname.toLowerCase()
    const isAnitabiHost = host === 'anitabi.cn' || host.endsWith('.anitabi.cn')
    if (isAnitabiHost) {
      url.searchParams.delete('plan')
      // Add resize params if not present for optimized loading
      if (!url.searchParams.has('w')) {
        url.searchParams.set('w', '640')
        url.searchParams.set('q', '80')
      }
    }
    return url.toString()
  } catch {
    return raw
  }
}

function normalizePointImageSaveUrl(input: string | null | undefined): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null

  try {
    const url = new URL(raw, 'https://seichigo.com')
    const host = url.hostname.toLowerCase()
    const isAnitabiHost = host === 'anitabi.cn' || host.endsWith('.anitabi.cn')
    if (isAnitabiHost) {
      url.searchParams.delete('plan')
      url.searchParams.delete('w')
      url.searchParams.delete('h')
      url.searchParams.delete('q')
    }
    return url.toString()
  } catch {
    return raw
  }
}

function normalizeCoverImageUrl(input: string | null | undefined): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  return raw
}

async function prefetchImageUrl(
  src: string,
  options?: {
    signal?: AbortSignal
    timeoutMs?: number
  },
): Promise<void> {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return
  const signal = options?.signal
  const timeoutMs = Math.max(200, options?.timeoutMs ?? WARMUP_IMAGE_TIMEOUT_MS)
  if (!src || signal?.aborted) return
  if (prefetchedPointImageUrls.has(src)) return
  if (prefetchingPointImageUrls.has(src)) return

  if (prefetchedPointImageUrls.size >= POINT_IMAGE_PREFETCH_CACHE_MAX) {
    prefetchedPointImageUrls.clear()
  }
  prefetchingPointImageUrls.add(src)

  try {
    const loaded = await new Promise<boolean>((resolve) => {
      const image = new Image()
      let finished = false
      let doneValue = false
      const finish = (value: boolean) => {
        if (finished) return
        finished = true
        doneValue = value
        resolve(doneValue)
      }

      const timer = window.setTimeout(() => {
        finish(false)
      }, timeoutMs)

      const onLoad = () => {
        window.clearTimeout(timer)
        finish(true)
      }
      const onFail = () => {
        window.clearTimeout(timer)
        finish(false)
      }

      if (signal) {
        if (signal.aborted) {
          onFail()
          return
        }
        signal.addEventListener('abort', onFail, { once: true })
      }

      image.decoding = 'async'
      image.loading = 'eager'
      image.referrerPolicy = 'no-referrer'
      image.onload = onLoad
      image.onerror = onFail
      image.src = src

      if (image.complete && image.naturalWidth > 0) {
        onLoad()
      }
    })

    if (loaded) {
      prefetchedPointImageUrls.add(src)
    }
  } finally {
    prefetchingPointImageUrls.delete(src)
  }
}

function warmPointImages(points: AnitabiBangumiDTO['points'], limit = POINT_IMAGE_PREFETCH_LIMIT): void {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return
  let count = 0
  for (const point of points) {
    if (count >= limit) break
    const src = normalizePointImageUrl(point.image)
    if (!src || prefetchedPointImageUrls.has(src) || prefetchingPointImageUrls.has(src)) continue
    void prefetchImageUrl(src).catch(() => null)
    count += 1
  }
}

function looksLikeImageUrl(input: string | null | undefined): boolean {
  const raw = String(input || '').trim()
  if (!raw) return false

  try {
    const url = new URL(raw, 'https://seichigo.com')
    const path = url.pathname.toLowerCase()
    if (/\.(avif|webp|png|jpe?g|gif|bmp|svg)$/.test(path)) return true
    const format = String(url.searchParams.get('format') || '').toLowerCase()
    if (format && ['avif', 'webp', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg'].includes(format)) return true
  } catch {
    if (/\.(avif|webp|png|jpe?g|gif|bmp|svg)(\?|#|$)/i.test(raw)) return true
  }

  return false
}

function buildFallbackRasterStyle(mode: 'street' | 'satellite'): maplibregl.StyleSpecification {
  if (mode === 'satellite') {
    return {
      version: 8,
      sources: {
        sat: {
          type: 'raster',
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Tiles © Esri',
        },
      },
      layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
    }
  }

  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  }
}

function normalizeMapStyleProvider(raw: string): MapStyleProvider | null {
  const value = String(raw || '').trim().toLowerCase()
  if (value === 'maptiler') return 'maptiler'
  if (value === 'mapbox') return 'mapbox'
  if (value === 'stadia') return 'stadia'
  if (value === 'raster') return 'raster'
  return null
}

function parseMapStyleProviderOrder(): MapStyleProvider[] {
  const out: MapStyleProvider[] = []
  const seen = new Set<MapStyleProvider>()
  for (const token of MAP_STYLE_PROVIDER_ORDER.split(',').map((item) => item.trim()).filter(Boolean)) {
    const provider = normalizeMapStyleProvider(token)
    if (!provider || seen.has(provider)) continue
    seen.add(provider)
    out.push(provider)
  }
  if (!seen.has('raster')) out.push('raster')
  return out
}

function buildMapStyleCandidate(provider: MapStyleProvider, mode: MapStyleMode): MapStyleCandidate | null {
  if (provider === 'raster') {
    return {
      provider,
      label: 'raster',
      style: buildFallbackRasterStyle(mode),
    }
  }
  if (!MAP_VECTOR_ENABLED) return null

  if (provider === 'maptiler') {
    if (!MAPTILER_KEY) return null
    const styleId = mode === 'satellite' ? 'hybrid' : 'streets-v2'
    return {
      provider,
      label: 'MapTiler',
      style: `https://api.maptiler.com/maps/${styleId}/style.json?key=${encodeURIComponent(MAPTILER_KEY)}`,
    }
  }

  if (provider === 'mapbox') {
    if (!MAPBOX_TOKEN) return null
    const styleId = mode === 'satellite' ? 'satellite-streets-v12' : 'streets-v12'
    return {
      provider,
      label: 'Mapbox',
      style: `https://api.mapbox.com/styles/v1/mapbox/${styleId}?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`,
    }
  }

  if (provider === 'stadia') {
    if (!STADIA_KEY) return null
    const styleId = mode === 'satellite' ? 'alidade_satellite' : 'alidade_smooth'
    return {
      provider,
      label: 'Stadia',
      style: `https://tiles.stadiamaps.com/styles/${styleId}.json?api_key=${encodeURIComponent(STADIA_KEY)}`,
    }
  }

  return null
}

function getMapStyleCandidates(mode: MapStyleMode): MapStyleCandidate[] {
  const orderedProviders = parseMapStyleProviderOrder()
  const out: MapStyleCandidate[] = []
  for (const provider of orderedProviders) {
    const candidate = buildMapStyleCandidate(provider, mode)
    if (!candidate) continue
    out.push(candidate)
  }
  if (!out.length || out[out.length - 1]?.provider !== 'raster') {
    out.push({
      provider: 'raster',
      label: 'raster',
      style: buildFallbackRasterStyle(mode),
    })
  }
  return out
}

function geoLink(point: { geo: [number, number] | null }): string | null {
  if (!point.geo) return null
  return `https://www.google.com/maps?q=${point.geo[0]},${point.geo[1]}`
}

function resolvePanoramaLocation(point: { geo: [number, number] | null; originLink?: string | null }): { lat: number; lng: number } | null {
  if (isValidGeoPair(point.geo)) {
    return { lat: point.geo[0], lng: point.geo[1] }
  }
  if (!point.originLink) return null
  return extractLatLngFromGoogleMapsUrl(point.originLink)
}

function buildGoogleStreetViewEmbedSrc(location: { lat: number; lng: number }): string | null {
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null
  const params = new URLSearchParams()
  params.set('layer', 'c')
  params.set('cbll', `${location.lat.toFixed(6)},${location.lng.toFixed(6)}`)
  params.set('cbp', '12,0,0,0,0')
  params.set('output', 'svembed')
  return `https://maps.google.com/maps?${params.toString()}`
}

function extractMapillaryImageKey(rawInput: string | null | undefined): string | null {
  const raw = String(rawInput || '').trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    const isMapillaryHost = host === 'mapillary.com' || host.endsWith('.mapillary.com')
    if (!isMapillaryHost) return null

    const queryKey = url.searchParams.get('pKey') || url.searchParams.get('image_key')
    if (queryKey) return queryKey

    const segments = url.pathname.split('/').filter(Boolean)
    if (!segments.length) return null
    const knownPrefix = ['app', 'embed', 'map', 'photo', 'image']
    const idx = segments.findIndex((seg) => knownPrefix.includes(seg.toLowerCase()))
    if (idx >= 0 && segments[idx + 1]) return segments[idx + 1]
  } catch {
    // noop
  }

  return null
}

function buildMapillaryEmbedSrc(imageKey: string): string | null {
  const key = imageKey.trim()
  if (!key) return null
  const params = new URLSearchParams()
  params.set('image_key', key)
  params.set('style', 'photo')
  return `https://www.mapillary.com/embed?${params.toString()}`
}

function resolvePanoramaEmbed(point: { geo: [number, number] | null; originLink?: string | null }): PanoramaEmbed | null {
  const location = resolvePanoramaLocation(point)
  if (location) {
    const googleSrc = buildGoogleStreetViewEmbedSrc(location)
    if (googleSrc) return { provider: 'google', src: googleSrc }
  }

  const mapillaryKey = extractMapillaryImageKey(point.originLink)
  if (mapillaryKey) {
    const mapillarySrc = buildMapillaryEmbedSrc(mapillaryKey)
    if (mapillarySrc) return { provider: 'mapillary', src: mapillarySrc }
  }

  return null
}

function matchPointId(candidateId: string, pointId: string): boolean {
  if (candidateId === pointId) return true
  if (pointId.includes(':')) return false
  return candidateId.endsWith(`:${pointId}`)
}

function isValidGeoPair(geo: [number, number] | null): geo is [number, number] {
  return Array.isArray(geo) && Number.isFinite(geo[0]) && Number.isFinite(geo[1])
}

function collectPointCoords(points: AnitabiBangumiDTO['points']): PointCoord[] {
  return points
    .filter((point): point is typeof point & { geo: [number, number] } => isValidGeoPair(point.geo))
    .map((point) => [point.geo[1], point.geo[0]])
}

function buildPointFeatureCollection(
  detail: AnitabiBangumiDTO,
  selectedPointId: string | null,
  meState: MeState | null,
  viewFilter: 'all' | 'marked' = 'all',
  stateFilter: string[] = []
): GeoJSON.FeatureCollection<GeoJSON.Point, PointFeatureProperties> {
  const color = detail.card.color || '#6d28d9'
  const features: Array<GeoJSON.Feature<GeoJSON.Point, PointFeatureProperties>> = []

  for (const point of detail.points) {
    if (!isValidGeoPair(point.geo)) continue

    const userState = meState?.pointStates.find((ps) => ps.pointId === point.id)?.state || 'none'

    if (viewFilter === 'marked' && userState === 'none') continue
    if (stateFilter.length > 0 && !stateFilter.includes(userState)) continue

    features.push({
      type: 'Feature',
      properties: {
        pointId: point.id,
        color,
        selected: selectedPointId && matchPointId(point.id, selectedPointId) ? 1 : 0,
        userState,
      },
      geometry: {
        type: 'Point',
        coordinates: [point.geo[1], point.geo[0]],
      },
    })
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}

function createEmptyPointFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Point, PointFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: [],
  }
}

function getImageWarmupConcurrency(background = false): number {
  if (typeof navigator === 'undefined') {
    return background ? PRELOAD_IMAGE_BACKGROUND_CONCURRENCY : PRELOAD_IMAGE_BLOCKING_BASE_CONCURRENCY
  }
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection
  const effectiveType = String(connection?.effectiveType || '')
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return background ? 2 : 4
  if (effectiveType === '3g') return background ? 3 : 5
  return background ? PRELOAD_IMAGE_BACKGROUND_CONCURRENCY : PRELOAD_IMAGE_BLOCKING_BASE_CONCURRENCY
}

function toWarmDetailPoints(
  bangumiId: number,
  points: AnitabiPreloadChunkItemDTO['points'],
): AnitabiBangumiDTO['points'] {
  return points.map((point) => ({
    id: point.id,
    bangumiId,
    name: point.name,
    nameZh: point.nameZh,
    note: point.note,
    geo: point.geo,
    ep: point.ep,
    s: point.s,
    image: point.image,
    origin: null,
    originUrl: null,
    originLink: null,
    density: point.density,
    mark: point.note,
  }))
}

function buildWarmDetail(
  card: AnitabiBangumiCard,
  preloadItem: AnitabiPreloadChunkItemDTO | null,
): AnitabiBangumiDTO {
  return {
    card,
    description: null,
    tags: [],
    points: preloadItem ? toWarmDetailPoints(card.id, preloadItem.points) : [],
    customEpNames: {},
    theme: preloadItem?.theme || null,
    contributors: [],
  }
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI
}

function distanceMeters(a: PointCoord, b: PointCoord): number {
  const earthRadius = 6378137
  const lat1 = toRadians(a[1])
  const lat2 = toRadians(b[1])
  const latDelta = lat2 - lat1
  const lngDelta = toRadians(b[0] - a[0])
  const sinLat = Math.sin(latDelta / 2)
  const sinLng = Math.sin(lngDelta / 2)
  const m = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(m)))
}

function formatDistance(distanceMetersValue: number): string {
  if (!Number.isFinite(distanceMetersValue) || distanceMetersValue < 0) return ''
  if (distanceMetersValue >= 1000) {
    const kilometers = distanceMetersValue / 1000
    return `${kilometers.toFixed(kilometers >= 10 ? 1 : 2)} km`
  }
  return `${Math.round(distanceMetersValue)} m`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeLng(value: number): number {
  let next = value
  while (next > 180) next -= 360
  while (next < -180) next += 360
  return next
}

function moveByMeters(origin: PointCoord, bearingRad: number, meters: number): PointCoord {
  const earthRadius = 6378137
  const angularDistance = meters / earthRadius
  const lat1 = toRadians(origin[1])
  const lng1 = toRadians(origin[0])
  const sinLat2 = Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad)
  const lat2 = Math.asin(Math.min(1, Math.max(-1, sinLat2)))
  const y = Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1)
  const x = Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  const lng2 = lng1 + Math.atan2(y, x)
  return [normalizeLng(toDegrees(lng2)), toDegrees(lat2)]
}

function closeRing(points: PointCoord[]): PointCoord[] {
  if (!points.length) return points
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return points
  if (first[0] === last[0] && first[1] === last[1]) return points
  return [...points, [first[0], first[1]]]
}

function dedupePoints(points: PointCoord[]): PointCoord[] {
  const seen = new Set<string>()
  const out: PointCoord[] = []
  for (const point of points) {
    const key = `${point[0].toFixed(6)}:${point[1].toFixed(6)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(point)
  }
  return out
}

function cross(o: PointCoord, a: PointCoord, b: PointCoord): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function buildConvexHull(points: PointCoord[]): PointCoord[] {
  const sorted = dedupePoints(points)
    .slice()
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]))

  if (sorted.length <= 2) return sorted

  const lower: PointCoord[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: PointCoord[] = []
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function buildBBoxRing(points: PointCoord[], paddingMeters: number): PointCoord[] {
  const lngs = points.map((point) => point[0])
  const lats = points.map((point) => point[1])
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)

  const center: PointCoord = [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
  const corners: PointCoord[] = [
    [minLng, minLat],
    [minLng, maxLat],
    [maxLng, maxLat],
    [maxLng, minLat],
  ]

  return closeRing(
    corners.map((corner) => {
      const dx = corner[0] - center[0]
      const dy = corner[1] - center[1]
      const bearing = Math.atan2(dx, dy)
      return moveByMeters(corner, bearing, paddingMeters)
    })
  )
}

function buildSinglePointRing(point: PointCoord, paddingMeters: number): PointCoord[] {
  const bearings = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]
  return closeRing(bearings.map((bearing) => moveByMeters(point, bearing, paddingMeters)))
}

function buildTwoPointRing(a: PointCoord, b: PointCoord, paddingMeters: number): PointCoord[] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const nearSamePoint = Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9
  if (nearSamePoint) return buildSinglePointRing(a, paddingMeters)

  const heading = Math.atan2(dx, dy)
  const left = heading - Math.PI / 2
  const right = heading + Math.PI / 2
  const tail = heading + Math.PI
  const extension = paddingMeters * 0.8

  const aLeft = moveByMeters(moveByMeters(a, left, paddingMeters), tail, extension)
  const aRight = moveByMeters(moveByMeters(a, right, paddingMeters), tail, extension)
  const bLeft = moveByMeters(moveByMeters(b, left, paddingMeters), heading, extension)
  const bRight = moveByMeters(moveByMeters(b, right, paddingMeters), heading, extension)

  return closeRing([aLeft, bLeft, bRight, aRight])
}

function padHull(points: PointCoord[], paddingMeters: number): PointCoord[] {
  const [sumLng, sumLat] = points.reduce<[number, number]>(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1]],
    [0, 0]
  )
  const center: PointCoord = [sumLng / points.length, sumLat / points.length]

  return closeRing(
    points.map((point) => {
      const dx = point[0] - center[0]
      const dy = point[1] - center[1]
      const bearing = Math.atan2(dx, dy)
      return moveByMeters(point, bearing, paddingMeters)
    })
  )
}

function buildCoverageArea(points: PointCoord[]): GeoJSON.FeatureCollection<GeoJSON.Polygon> | null {
  if (!points.length) return null

  const deduped = dedupePoints(points)
  const lngs = deduped.map((point) => point[0])
  const lats = deduped.map((point) => point[1])
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const bboxDiagMeters = distanceMeters([minLng, minLat], [maxLng, maxLat])

  const smallPaddingMeters = clamp(Math.max(800, bboxDiagMeters * 0.18), 800, 60000)
  const largePaddingMeters = clamp(Math.max(900, bboxDiagMeters * 0.08), 900, 70000)

  let ring: PointCoord[]
  if (deduped.length === 1) {
    ring = buildSinglePointRing(deduped[0]!, smallPaddingMeters)
  } else if (deduped.length === 2) {
    ring = buildTwoPointRing(deduped[0]!, deduped[1]!, smallPaddingMeters)
  } else if (deduped.length < 3) {
    ring = buildBBoxRing(deduped, smallPaddingMeters)
  } else {
    const hull = buildConvexHull(deduped)
    if (hull.length < 3) {
      ring = buildBBoxRing(deduped, smallPaddingMeters)
    } else {
      ring = padHull(hull, largePaddingMeters)
    }
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          pointsLength: points.length,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      },
    ],
  }
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

function buildDistanceClusters(points: PointCoord[]): PointCoord[][] {
  const deduped = dedupePoints(points)
  const n = deduped.length
  if (n === 0) return []
  if (n <= 2) return [deduped]

  const nearest = Array.from({ length: n }, () => Number.POSITIVE_INFINITY)
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = distanceMeters(deduped[i]!, deduped[j]!)
      if (d < nearest[i]!) nearest[i] = d
      if (d < nearest[j]!) nearest[j] = d
    }
  }

  const nearestFinite = nearest.filter((x) => Number.isFinite(x) && x > 0)
  const joinDistance = clamp(
    Math.max(CLUSTER_JOIN_DISTANCE_MIN_METERS, median(nearestFinite) * CLUSTER_JOIN_DISTANCE_SCALE),
    CLUSTER_JOIN_DISTANCE_MIN_METERS,
    CLUSTER_JOIN_DISTANCE_MAX_METERS
  )

  const parent = Array.from({ length: n }, (_, idx) => idx)
  const find = (idx: number): number => {
    let root = idx
    while (parent[root] !== root) {
      root = parent[root]!
    }
    let node = idx
    while (parent[node] !== node) {
      const next = parent[node]!
      parent[node] = root
      node = next
    }
    return root
  }
  const union = (a: number, b: number) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA === rootB) return
    if (rootA < rootB) parent[rootB] = rootA
    else parent[rootA] = rootB
  }

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (distanceMeters(deduped[i]!, deduped[j]!) <= joinDistance) {
        union(i, j)
      }
    }
  }

  const grouped = new Map<number, PointCoord[]>()
  for (let i = 0; i < n; i += 1) {
    const root = find(i)
    const list = grouped.get(root)
    if (list) list.push(deduped[i]!)
    else grouped.set(root, [deduped[i]!])
  }

  return Array.from(grouped.values()).sort((a, b) => b.length - a.length)
}

function clusterSpreadMeters(cluster: PointCoord[]): number {
  if (!cluster.length) return Number.POSITIVE_INFINITY
  if (cluster.length === 1) return 0
  const lngs = cluster.map((point) => point[0])
  const lats = cluster.map((point) => point[1])
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  return distanceMeters([minLng, minLat], [maxLng, maxLat])
}

function clusterNearestMedianMeters(cluster: PointCoord[]): number {
  if (cluster.length < 2) return Number.POSITIVE_INFINITY
  const nearest: number[] = []
  for (let i = 0; i < cluster.length; i += 1) {
    let best = Number.POSITIVE_INFINITY
    for (let j = 0; j < cluster.length; j += 1) {
      if (i === j) continue
      const d = distanceMeters(cluster[i]!, cluster[j]!)
      if (d < best) best = d
    }
    if (Number.isFinite(best)) nearest.push(best)
  }
  return median(nearest)
}

function pickFocusCluster(points: PointCoord[]): PointCoord[] {
  const clusters = buildDistanceClusters(points)
  if (!clusters.length) return []
  if (clusters.length === 1) return clusters[0]!

  let pool = clusters.filter((cluster) => cluster.length >= 3)
  if (!pool.length) pool = clusters.filter((cluster) => cluster.length >= 2)
  if (!pool.length) return clusters[0]!

  let best = pool[0]!
  let bestMedian = clusterNearestMedianMeters(best)
  let bestCount = best.length
  let bestSpread = clusterSpreadMeters(best)

  for (const cluster of pool.slice(1)) {
    const nextMedian = clusterNearestMedianMeters(cluster)
    const nextCount = cluster.length
    const nextSpread = clusterSpreadMeters(cluster)

    if (nextMedian < bestMedian - 1) {
      best = cluster
      bestMedian = nextMedian
      bestCount = nextCount
      bestSpread = nextSpread
      continue
    }

    if (Math.abs(nextMedian - bestMedian) <= 1 && nextCount > bestCount) {
      best = cluster
      bestMedian = nextMedian
      bestCount = nextCount
      bestSpread = nextSpread
      continue
    }

    if (Math.abs(nextMedian - bestMedian) <= 1 && nextCount === bestCount && nextSpread < bestSpread) {
      best = cluster
      bestMedian = nextMedian
      bestCount = nextCount
      bestSpread = nextSpread
    }
  }

  return best
}

function buildBounds(points: PointCoord[]): maplibregl.LngLatBounds | null {
  if (!points.length) return null
  const bounds = new maplibregl.LngLatBounds(points[0], points[0])
  for (const point of points.slice(1)) {
    bounds.extend(point)
  }
  return bounds
}

function removeRangeLayer(map: maplibregl.Map): void {
  if (map.getLayer(RANGE_LINE_LAYER_ID)) map.removeLayer(RANGE_LINE_LAYER_ID)
  if (map.getLayer(RANGE_FILL_LAYER_ID)) map.removeLayer(RANGE_FILL_LAYER_ID)
  if (map.getSource(RANGE_SOURCE_ID)) map.removeSource(RANGE_SOURCE_ID)
}

function removePointLayer(map: maplibregl.Map): void {
  if (map.getLayer(POINT_SELECTED_LAYER_ID)) map.removeLayer(POINT_SELECTED_LAYER_ID)
  if (map.getLayer(POINT_SELECTED_HALO_LAYER_ID)) map.removeLayer(POINT_SELECTED_HALO_LAYER_ID)
  if (map.getLayer(POINT_LAYER_ID)) map.removeLayer(POINT_LAYER_ID)
  if (map.getSource(POINT_SOURCE_ID)) map.removeSource(POINT_SOURCE_ID)
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(236, 72, 153, ${alpha})`
  }

  const fullHex = normalized.length === 3 ? normalized.split('').map((c) => `${c}${c}`).join('') : normalized
  const r = Number.parseInt(fullHex.slice(0, 2), 16)
  const g = Number.parseInt(fullHex.slice(2, 4), 16)
  const b = Number.parseInt(fullHex.slice(4, 6), 16)
  const clampedAlpha = Math.max(0, Math.min(1, alpha))
  return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`
}

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
  const initialOpenBangumiDoneRef = useRef(false)
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
  const warmupMetricRef = useRef<Record<string, number>>({})
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

  const selectedPoint = useMemo(() => {
    if (!detail || !selectedPointId) return null
    return detail.points.find((point) => matchPointId(point.id, selectedPointId)) || null
  }, [detail, selectedPointId])

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
    if (!selectedPointPanorama) return
    if (autoPanoramaDismissedRef.current) return
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

    const fc = completeFeatureCollectionRef.current
    // In simple mode, hide complete mode
    if (mapModeRef.current === 'simple') {
      removeCompleteModeLayers(map)
      removeLabelLayer(map)
      coverAvatarLoaderRef.current = null
      loadedCoverIdsRef.current = new Set()
      completeCoverFeatureCollectionRef.current = null
      completeCoverCandidatesRef.current = []
      return true
    }

    if (!fc || fc.features.length === 0) {
      removeCompleteModeLayers(map)
      removeLabelLayer(map)
      loadedCoverIdsRef.current = new Set()
      completeCoverFeatureCollectionRef.current = null
      completeCoverCandidatesRef.current = []
      return true
    }

    // If a bangumi is selected in complete mode, filter to just that bangumi
    if (detailRef.current) {
      const filteredFc = {
        type: 'FeatureCollection' as const,
        features: fc.features.filter(
          (f) => f.properties.bangumiId === String(detailRef.current!.card.id)
        ),
      }
      ensureCompleteModeSources(map)
      ensureCompleteModeSymbolLayer(map)
      updateCompleteModeSources(map, filteredFc)
      const detailBangumiId = detailRef.current.card.id
      const coverBase = completeCoverFeatureCollectionRef.current
      const detailCoverCollection: GeoJSON.FeatureCollection = coverBase
        ? {
            type: 'FeatureCollection',
            features: coverBase.features.filter((feature) => {
              const raw = (feature.properties as { bangumiId?: unknown } | undefined)?.bangumiId
              if (typeof raw === 'number') return raw === detailBangumiId
              if (typeof raw === 'string') return Number.parseInt(raw, 10) === detailBangumiId
              return false
            }),
          }
        : { type: 'FeatureCollection', features: [] }
      updateCompleteModeCoverSource(map, detailCoverCollection, loadedCoverIdsRef.current)

      if (coverAvatarLoaderRef.current && completeCoverCandidatesRef.current.length > 0) {
        const coverCandidates = completeCoverCandidatesRef.current
        void coverAvatarLoaderRef.current.updateViewport(coverCandidates).then((ids) => {
          loadedCoverIdsRef.current = ids
          const liveMap = mapRef.current
          if (!liveMap || !liveMap.isStyleLoaded()) return
          updateCompleteModeCoverSource(liveMap, detailCoverCollection, ids)
          liveMap.triggerRepaint()
        }).catch(() => null)
      }

      map.triggerRepaint()
      return true
    }

    try {
      ensureCompleteModeSources(map)
      ensureCompleteModeSymbolLayer(map)
      updateCompleteModeSources(map, fc)
      updateCompleteModeCoverSource(
        map,
        completeCoverFeatureCollectionRef.current || { type: 'FeatureCollection', features: [] },
        loadedCoverIdsRef.current,
      )

      if (coverAvatarLoaderRef.current && completeCoverCandidatesRef.current.length > 0) {
        const coverCandidates = completeCoverCandidatesRef.current
        void coverAvatarLoaderRef.current.updateViewport(coverCandidates).then((ids) => {
          loadedCoverIdsRef.current = ids
          const liveMap = mapRef.current
          const coverFc = completeCoverFeatureCollectionRef.current
          if (!liveMap || !liveMap.isStyleLoaded() || !coverFc) return
          updateCompleteModeCoverSource(liveMap, coverFc, ids)
          liveMap.triggerRepaint()
        }).catch(() => null)
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
  }, [])

  useEffect(() => {
    syncCompleteModeRef.current = flushCompleteMode
  }, [flushCompleteMode])

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

    // Treat percent>=100 as ready, even if phase lingers at loading due async tail tasks.
    const warmupComplete = warmupProgress.percent >= 100 || warmupProgress.phase === 'done'
    if (!warmupComplete) return

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
        .slice(0, 180)
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
        coverAvatarLoaderRef.current = new CoverAvatarLoader({ map, maxLoaded: 160 })
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

      for (const bangumi of bangumiDataList) {
        if (controller.signal.aborted) return

        const theme = bangumi.theme
        if (!isValidTheme(theme)) continue

        try {
          const sprites = await cutSpriteSheet(
            bangumi.bangumiId,
            theme as AnitabiTheme,
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
  }, [detail, mapMode, warmupProgress.phase, warmupProgress.percent])

  // Complete Mode useEffect 2 — Click handler for complete mode layers
  // Uses openBangumiRef to avoid declaration-order issues with openBangumi callback
  const openBangumiRef = useRef<((id: number, pointId?: string | null) => Promise<void>) | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (detail) return

    const handleCompleteModeClick = (event: maplibregl.MapMouseEvent) => {
      const completeLayerIds = [COMPLETE_ICONS_LAYER_ID, COMPLETE_BANGUMI_COVERS_LAYER_ID, COMPLETE_DOTS_LAYER_ID].filter(
        (id) => Boolean(map.getLayer(id))
      )
      if (!completeLayerIds.length) return

      const hit = map.queryRenderedFeatures(event.point, { layers: completeLayerIds })[0]
      if (!hit) return

      const pointId = hit.properties?.pointId
      const bangumiId = hit.properties?.bangumiId
      if (!bangumiId) return

      const numericBangumiId = typeof bangumiId === 'string' ? parseInt(bangumiId, 10) : Number(bangumiId)
      if (!Number.isFinite(numericBangumiId)) return

      if (typeof pointId === 'string') {
        openBangumiRef.current?.(numericBangumiId, pointId)?.catch(() => null)
      } else {
        openBangumiRef.current?.(numericBangumiId)?.catch(() => null)
      }
    }

    map.on('click', handleCompleteModeClick)
    return () => {
      map.off('click', handleCompleteModeClick)
    }
  }, [detail, mapReady])

  // Complete Mode useEffect 3 — Cleanup on unmount
  useEffect(() => () => {
    completeAbortRef.current?.abort()
    completeAbortRef.current = null

    const map = mapRef.current
    if (map) {
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

  const updateWarmupProgress = useCallback((next: Partial<WarmupProgress>) => {
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
    for (const key of Object.keys(tasks) as WarmupTaskKey[]) {
      const weight = WARMUP_TASK_WEIGHTS[key]
      weightedSum += tasks[key].percent * weight
      totalWeight += weight
    }
    if (!totalWeight) return 0
    return Math.round(weightedSum / totalWeight)
  }, [])

  const resetWarmupTaskProgress = useCallback(() => {
    setWarmupTaskProgress(createEmptyWarmupTaskProgress())
  }, [])

  const updateWarmupTask = useCallback((key: WarmupTaskKey, next: { percent?: number; detail?: string }) => {
    setWarmupTaskProgress((prev) => {
      const current = prev[key]
      const merged: WarmupTaskProgress = {
        ...prev,
        [key]: {
          percent: Math.max(0, Math.min(100, next.percent ?? current.percent)),
          detail: next.detail ?? current.detail,
        },
      }
      const combinedPercent = computeWarmupPercent(merged)
      setWarmupProgress((prevWarmup) => ({
        phase: prevWarmup.phase === 'idle' && warmupBlockingUiRef.current ? 'loading' : prevWarmup.phase,
        percent: combinedPercent,
        title: label.preloadTitle,
        detail: next.detail ?? prevWarmup.detail,
      }))
      return merged
    })
  }, [computeWarmupPercent, label.preloadTitle])

  const completeAllWarmupTasks = useCallback(() => {
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

  const preloadMapBaseLayer = useCallback(async (signal?: AbortSignal) => {
    updateWarmupTask('map', { percent: 2, detail: label.preloadMapPreparing })
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
        updateWarmupTask('map', { percent, detail })
        cleanup()
        resolve()
      }

      const onStyleData = () => {
        updateWarmupTask('map', { percent: 45, detail: label.preloadMapPreparing })
      }
      const onLoadOrIdle = () => {
        updateWarmupTask('map', { percent: 78, detail: label.preloadMapTiles })
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

    const cached = await store.getPreloadManifest().catch(() => null)
    const fallback = cached?.manifest || null
    if (fallback) preloadManifestRef.current = fallback

    try {
      const res = await fetch(`/api/anitabi/preload/manifest?locale=${encodeURIComponent(locale)}`, {
        method: 'GET',
        signal,
      })
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

    const cached = await store.getPreloadChunk(index).catch(() => null)
    if (cached && cached.datasetVersion === manifest.datasetVersion && Array.isArray(cached.chunk.items)) {
      return cached.chunk.items
    }

    const res = await fetch(
      `/api/anitabi/preload/chunks/${index}?locale=${encodeURIComponent(locale)}`,
      { method: 'GET', signal },
    )
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

    const startedAt = performance.now()
    warmupBlockingUiRef.current = !background
    setWarmupUiBlocking(!background)
    setCardsLoadError(null)
    resetWarmupTaskProgress()
    updateWarmupProgress({ phase: 'loading', percent: 0, detail: label.preloadMapPreparing })
    updateWarmupTask('cards', { percent: 0, detail: `${label.preloadCards} (0/0)` })
    updateWarmupTask('details', { percent: 0, detail: `${label.preloadDetails} (0/0)` })
    updateWarmupTask('images', { percent: 0, detail: `${label.preloadImages} (0/0)` })

    const mapStartedAt = performance.now()
    const mapWarmupPromise = preloadMapBaseLayer(signal).finally(() => {
      warmupMetricRef.current.map_ms = Math.round(performance.now() - mapStartedAt)
    })

    const manifestPromise = (async (): Promise<AnitabiPreloadManifestDTO> => {
      const manifestStartedAt = performance.now()
      const manifest = await fetchPreloadManifest(signal)
      if (signal?.aborted) throw new Error('aborted')
      if (!manifest) throw new Error('preload manifest unavailable')
      warmupMetricRef.current.manifest_ms = Math.round(performance.now() - manifestStartedAt)
      updateWarmupTask('cards', { percent: 25, detail: `${label.preloadCards} (1/4)` })
      hydrateTabCardsFromManifest(manifest)
      updateWarmupTask('cards', { percent: 100, detail: `${label.preloadCards} (4/4)` })
      setLoading(false)
      return manifest
    })()

    const detailsWarmupPromise = (async () => {
      const manifest = await manifestPromise
      if (signal?.aborted) return

      const chunkCount = Math.max(0, manifest.chunkCount)
      warmPointIndexByBangumiIdRef.current.clear()
      const chunkQueue = Array.from({ length: chunkCount }, (_, idx) => idx)
      let chunkDone = 0
      let pointsLoaded = 0
      let lastVisualSyncAt = 0
      if (chunkCount > 0) {
        updateWarmupTask('details', { percent: 0, detail: `${label.preloadDetails} (0/${chunkCount})` })
        const chunkStartedAt = performance.now()
        const workers = Math.min(PRELOAD_CHUNK_CONCURRENCY, chunkQueue.length)
        await Promise.all(Array.from({ length: workers }, async () => {
          for (;;) {
            if (signal?.aborted) return
            const index = chunkQueue.shift()
            if (index == null) return

            const items = await fetchPreloadChunkByIndex(manifest, index, signal).catch(() => [] as AnitabiPreloadChunkItemDTO[])
            for (const item of items) {
              warmPointIndexByBangumiIdRef.current.set(item.bangumiId, item)
              pointsLoaded += item.points.length
            }

            chunkDone += 1
            updateWarmupTask('details', {
              percent: Math.round((chunkDone / chunkCount) * 100),
              detail: `${label.preloadDetails} (${chunkDone}/${chunkCount}) · ${pointsLoaded}`,
            })

            const now = performance.now()
            if (chunkDone === 1 || chunkDone === chunkCount || now - lastVisualSyncAt >= 900) {
              lastVisualSyncAt = now
              setTabCardsVersion((prev) => prev + 1)
            }
          }
        }))
        warmupMetricRef.current.chunks_ms = Math.round(performance.now() - chunkStartedAt)
      } else {
        updateWarmupTask('details', { percent: 100, detail: `${label.preloadDetails} (0/0)` })
      }

      if (signal?.aborted) return
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

    const imagesWarmupPromise = (async () => {
      const manifest = await manifestPromise
      if (signal?.aborted) return

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
      const deadline = Date.now() + WARMUP_BLOCKING_BUDGET_MS
      const runQueue = async (queue: string[], total: number) => {
        if (!queue.length || total <= 0) return
        const workers = Math.min(getImageWarmupConcurrency(false), queue.length)
        await Promise.all(Array.from({ length: workers }, async () => {
          for (;;) {
            if (signal?.aborted || Date.now() > deadline) return
            const src = queue.shift()
            if (!src) return
            await prefetchImageUrl(src, { signal, timeoutMs: WARMUP_IMAGE_TIMEOUT_MS }).catch(() => null)
            done += 1
            if (done === total || done % 8 === 0) {
              updateWarmupTask('images', {
                percent: Math.round((done / total) * 100),
                detail: `${label.preloadImages} (${done}/${total})`,
              })
            }
          }
        }))
      }

      updateWarmupTask('images', { percent: 0, detail: `${label.preloadImages} (0/${queueCovers.length})` })
      await runQueue(queueCovers, queueCovers.length)
      if (signal?.aborted || Date.now() > deadline) return

      await detailsWarmupPromise
      if (signal?.aborted || Date.now() > deadline) return

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
        updateWarmupTask('images', { percent: 100, detail: `${label.preloadImages} (0/0)` })
        return
      }
      if (queueActive.length > 0) {
        updateWarmupTask('images', { percent: Math.round((done / total) * 100), detail: `${label.preloadImages} (${done}/${total})` })
      }
      await runQueue(queueActive, total)
      updateWarmupTask('images', { percent: 100, detail: `${label.preloadImages} (${Math.min(done, total)}/${total})` })
    })()

    await Promise.all([mapWarmupPromise, detailsWarmupPromise, imagesWarmupPromise])
    if (signal?.aborted) {
      setWarmupUiBlocking(false)
      return
    }

    completeAllWarmupTasks()
    updateWarmupProgress({ phase: 'done', percent: 100, detail: label.preloadDone })
    setWarmupUiBlocking(false)
    warmupMetricRef.current.unlock_ms = Math.round(performance.now() - startedAt)
    window.setTimeout(() => {
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
    if (!signal?.aborted && bgQueue.length > 0) {
      void Promise.all(Array.from({ length: Math.min(getImageWarmupConcurrency(true), bgQueue.length) }, async () => {
        for (;;) {
          if (signal?.aborted) return
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
        setDetail(warmDetail)
        if (warmDetail.points.length > 0) {
          warmPointImages(warmDetail.points)
          focusByDetail(warmDetail, pointId)
        }
        flushPointLayerSoon()
        if (!isDesktop) {
          setMobilePanelOpen(true)
        }
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
          setDetail(cached)
          const cachedCover = normalizeCoverImageUrl(cached.card.cover)
          if (cachedCover) void prefetchImageUrl(cachedCover).catch(() => null)
          warmPointImages(cached.points)
          flushPointLayerSoon()
          focusByDetail(cached, pointId)
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
        setDetail(json)
        const nextCover = normalizeCoverImageUrl(json.card.cover)
        if (nextCover) void prefetchImageUrl(nextCover).catch(() => null)
        warmPointImages(json.points)
        flushPointLayerSoon()
        focusByDetail(json, pointId)
        pushHistory()
      } finally {
        firstOpenPointGuardTimerRef.current = window.setTimeout(() => {
          if (activeBangumiIdRef.current !== id) return
          if (firstOpenPointVisibleRecordedRef.current) return
          warmupMetricRef.current.first_open_point_missing = (warmupMetricRef.current.first_open_point_missing || 0) + 1
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
        setWarmupUiBlocking(false)
      })
    })().catch(() => null)
    return () => {
      ac.abort()
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
    if (!parsed.b || initialOpenBangumiDoneRef.current) return
    initialOpenBangumiDoneRef.current = true
    openBangumi(parsed.b, parsed.p).catch(() => null)
  }, [openBangumi, parsed.b, parsed.p])

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
    }
    map.on('moveend', syncMapViewState)
    map.on('zoomend', syncMapViewState)
    const pointLayerIds = () => [POINT_SELECTED_LAYER_ID, POINT_LAYER_ID].filter((id) => Boolean(map.getLayer(id)))
    const readPointIdFromRendered = (event: maplibregl.MapMouseEvent): string | null => {
      const layers = pointLayerIds()
      if (!layers.length) return null
      const hit = map.queryRenderedFeatures(event.point, { layers })[0]
      const pointId = hit?.properties?.pointId
      return typeof pointId === 'string' ? pointId : null
    }
    const handlePointClick = (event: maplibregl.MapMouseEvent) => {
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
      map.getCanvas().style.cursor = readPointIdFromRendered(event) ? 'pointer' : ''
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

    map.on('styledata', onMapStyleData)
    map.on('idle', onMapIdle)
    map.on('error', onMapError)
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

  useEffect(() => {
    if (!locateHint) return
    const timer = window.setTimeout(() => {
      setLocateHint(null)
    }, 6000)
    return () => window.clearTimeout(timer)
  }, [locateHint])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleResize = () => {
      const desktop = window.innerWidth >= DESKTOP_BREAKPOINT
      setIsDesktop(desktop)
      if (desktop) {
        setMobilePanelOpen(false)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const rafId = window.requestAnimationFrame(() => {
      map.resize()
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [isDesktop, mobilePanelOpen])

  useEffect(() => {
    if (isDesktop) {
      setMobilePointPopupOpen(false)
    }
  }, [isDesktop])

  useEffect(() => {
    if (!selectedPoint) {
      setMobilePointPopupOpen(false)
    }
  }, [selectedPoint])

  const onSubmitQuery = useCallback(() => {
    setQuery(queryInput.trim())
    // Keep searchOpen so the dropdown results remain visible for the user to pick from
  }, [queryInput])

  const onRandom = useCallback(() => {
    if (!cards.length) return
    const picked = cards[Math.floor(Math.random() * cards.length)]
    if (!picked) return
    openBangumi(picked.id).catch(() => null)
  }, [cards, openBangumi])

  const enterPanorama = useCallback(() => {
    if (!selectedPointPanorama) return
    setPanoramaError(null)
    setMapViewMode('panorama')
    if (!isDesktopRef.current) {
      setMobilePointPopupOpen(false)
    }
  }, [selectedPointPanorama])

  const openImagePreview = useCallback((imageUrl: string | null | undefined, pointName: string, saveUrl?: string | null) => {
    const src = String(imageUrl || '').trim()
    if (!src) return
    const saveTarget = String(saveUrl || '').trim() || src
    setImageSaving(false)
    setImageSaveError(null)
    setImagePreview({ src, name: pointName, saveUrl: saveTarget })
  }, [])

  const onImagePreviewOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setImagePreview(null)
      setImageSaving(false)
      setImageSaveError(null)
    }
  }, [])

  const renderPointImage = useCallback(
    (imageUrl: string | null | undefined, pointName: string, saveUrl?: string | null, eager = false) => {
      const src = String(imageUrl || '').trim()
      if (!src) {
        return (
          <div className="grid h-40 w-full place-items-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            {label.noImage}
          </div>
        )
      }

      return (
        <button
          type="button"
          className="group relative block h-40 w-full overflow-hidden rounded-md"
          onClick={() => openImagePreview(src, pointName, saveUrl)}
          title={label.previewImage}
          aria-label={label.previewImage}
        >
          <img
            src={src}
            alt={pointName}
            width={640}
            height={360}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.01]"
            loading={eager ? 'eager' : 'lazy'}
            fetchPriority={eager ? 'high' : 'auto'}
            decoding="async"
          />
          <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
            {label.previewImage}
          </span>
        </button>
      )
    },
    [label.noImage, label.previewImage, openImagePreview]
  )

  const saveOriginalImage = useCallback(async () => {
    if (!imagePreview?.saveUrl || imageSaving) return

    setImageSaveError(null)
    setImageSaving(true)

    try {
      const params = new URLSearchParams()
      params.set('url', imagePreview.saveUrl)
      if (imagePreview.name) params.set('name', imagePreview.name)

      const res = await fetch(`/api/anitabi/image-download?${params.toString()}`)
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: unknown } | null
        const msg = String(data?.error || '').trim()
        throw new Error(msg || 'download_failed')
      }

      const blob = await res.blob()
      if (!blob.size) {
        throw new Error('empty_file')
      }

      const hintedName = parseContentDispositionFilename(res.headers.get('content-disposition'))
      const fallbackBase = sanitizeDownloadFileNameBase(imagePreview.name)
      const fallbackName = `${fallbackBase}${extensionFromMimeType(blob.type)}`
      const fileName = hintedName || fallbackName

      const objectUrl = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl)
      }, 1200)
    } catch (err) {
      const msg = String((err as Error)?.message || '').trim()
      setImageSaveError(msg && msg !== 'download_failed' ? msg : label.saveOriginalFailed)
    } finally {
      setImageSaving(false)
    }
  }, [imagePreview, imageSaving, label.saveOriginalFailed])

  const exitPanorama = useCallback(() => {
    if (mapZoom >= PANORAMA_TRIGGER_ZOOM) {
      autoPanoramaDismissedRef.current = true
    }
    setPanoramaError(null)
    setMapViewMode('map')
  }, [mapZoom])

  const paintUserMarker = useCallback((lng: number, lat: number) => {
    const map = mapRef.current
    if (!map) return

    if (!userMarkerRef.current) {
      const el = document.createElement('div')
      el.style.width = '16px'
      el.style.height = '16px'
      el.style.borderRadius = '999px'
      el.style.background = '#2563eb'
      el.style.border = '2px solid white'
      el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)'
      userMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
      return
    }

    userMarkerRef.current.setLngLat([lng, lat])
  }, [])

  const locateUser = useCallback((options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent)
    if (typeof window === 'undefined') return
    if (!window.isSecureContext) {
      if (!silent) setLocateHint(label.locateInsecure)
      return
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      if (!silent) setLocateHint(label.locateUnavailable)
      return
    }

    setLocating(true)
    if (!silent) setLocateHint(null)

    const resolveFailure = (error: GeolocationPositionError) => {
      setLocating(false)
      if (silent) return
      if (error.code === error.PERMISSION_DENIED) {
        setLocateHint(label.locateDenied)
      } else if (error.code === error.TIMEOUT) {
        setLocateHint(label.locateTimeout)
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        setLocateHint(label.locateUnavailable)
      } else {
        setLocateHint(label.locateFailed)
      }
    }

    const resolveSuccess = (position: GeolocationPosition) => {
      const map = mapRef.current
      if (!map) {
        setLocating(false)
        if (!silent) setLocateHint(label.mapNotReady)
        return
      }

      const { latitude, longitude, accuracy } = position.coords
      const roundedAccuracy = Number.isFinite(accuracy) ? Math.round(accuracy) : null
      const zoom = resolveLocateZoom(roundedAccuracy)
      const nextLocation: UserLocation = {
        lat: latitude,
        lng: longitude,
        accuracy: roundedAccuracy,
      }

      setUserLocation(nextLocation)
      writeStoredUserLocation(nextLocation)
      focusGeo([latitude, longitude], zoom, false)
      paintUserMarker(longitude, latitude)
      setLocating(false)
      if (!silent) {
        setLocateHint(roundedAccuracy != null ? `${label.located} (±${roundedAccuracy}m)` : label.located)
      }
    }

    const resolveError = (error: GeolocationPositionError, highAccuracy: boolean) => {
      if (highAccuracy && error.code !== error.PERMISSION_DENIED) {
        navigator.geolocation.getCurrentPosition(
          resolveSuccess,
          (fallbackError) => resolveFailure(fallbackError),
          {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 300000,
          }
        )
        return
      }
      resolveFailure(error)
    }

    navigator.geolocation.getCurrentPosition(
      resolveSuccess,
      (error) => resolveError(error, true),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    )
  }, [focusGeo, label.locateDenied, label.locateFailed, label.locateInsecure, label.locateTimeout, label.locateUnavailable, label.located, label.mapNotReady, paintUserMarker])

  const onLocate = useCallback(() => {
    locateUser()
  }, [locateUser])

  useEffect(() => {
    if (!mapReady || !userLocation) return
    paintUserMarker(userLocation.lng, userLocation.lat)
  }, [mapReady, paintUserMarker, userLocation])

  useEffect(() => {
    if (!mapReady) return
    if (parsed.hasViewport) return
    if (autoLocateAttemptedRef.current) return
    autoLocateAttemptedRef.current = true

    // Use cached location for instant initial display
    const cachedLocation = readStoredUserLocationRaw()
    if (cachedLocation) {
      focusGeo([cachedLocation.lat, cachedLocation.lng], resolveLocateZoom(cachedLocation.accuracy), false)
    }

    // Always fetch fresh location when permission is granted
    let canceled = false
    queryGeolocationPermissionState()
      .then((permissionState) => {
        if (canceled) return
        if (permissionState === 'granted') {
          locateUser({ silent: true })
        }
      })
      .catch(() => null)

    return () => {
      canceled = true
    }
  }, [focusGeo, locateUser, mapReady, parsed.hasViewport])

  // Location permission dialog for first-visit users
  useEffect(() => {
    if (!mapReady) return
    if (parsed.hasViewport) return

    let canceled = false
    queryGeolocationPermissionState()
      .then((permissionState) => {
        if (canceled) return
        if (permissionState === 'granted') {
          setTab('nearby')
          return
        }
        if (permissionState === 'denied') {
          setTab('latest')
          return
        }
        // permissionState is 'prompt' or null (API not supported)
        try {
          if (window.sessionStorage.getItem(LOCATION_DIALOG_DISMISSED_KEY) === '1') return
        } catch {
          // sessionStorage unavailable
        }
        setTab('latest')
        setLocationDialogOpen(true)
      })
      .catch(() => null)

    return () => {
      canceled = true
    }
  }, [mapReady, parsed.hasViewport])

  const onShare = useCallback(async () => {
    if (typeof window === 'undefined') return
    syncUrlRef.current()
    const href = window.location.href
    if (!isDesktop && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: label.title,
          url: href,
        })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(href)
        setLocateHint(label.shareCopied)
        return
      } catch {
        // fall through
      }
    }

    try {
      const textarea = document.createElement('textarea')
      textarea.value = href
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.top = '-9999px'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      textarea.setSelectionRange(0, textarea.value.length)
      const copied = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (copied) {
        setLocateHint(label.shareCopied)
        return
      }
    } catch {
      // ignore
    }

    setLocateHint(label.shareFailed)
    window.prompt(label.shareManualCopy, href)
  }, [isDesktop, label.shareCopied, label.shareFailed, label.shareManualCopy, label.title])

  const addPointToPointPool = useCallback(
    async (pointId: string) => {
      try {
        const res = await fetch('/api/me/point-pool', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pointId }),
        })
        const json = await res.json().catch(() => ({}))
        if (res.status === 401) {
          if (window.confirm(label.signInToPointPool)) {
            window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(window.location.href)}`
          }
          return
        }
        if (!res.ok) {
          setLocateHint(getApiErrorMessage(json) || label.addToPointPoolFailed)
          return
        }

        await loadMe()
        if (!hasSeenPointPoolHint()) {
          markPointPoolHintSeen()
          setLocateHint(label.pointPoolGuide)
          return
        }

        setLocateHint(label.addToPointPoolSuccess)
      } catch {
        setLocateHint(label.addToPointPoolFailed)
      }
    },
    [
      label.addToPointPoolFailed,
      label.addToPointPoolSuccess,
      label.pointPoolGuide,
      label.signInToPointPool,
      loadMe,
    ]
  )

  const redirectToSignInForRouteBook = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!window.confirm(label.signInToRouteBook)) return
    window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(window.location.href)}`
  }, [label.signInToRouteBook])

  const loadRouteBooks = useCallback(async () => {
    setRouteBookPickerLoading(true)
    setRouteBookPickerError(null)

    try {
      const res = await fetch('/api/me/routebooks', { method: 'GET' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setRouteBookPickerOpen(false)
        redirectToSignInForRouteBook()
        return
      }
      if (!res.ok) {
        setRouteBookPickerError(getApiErrorMessage(data) || label.addToRouteBookFailed)
        return
      }

      const rows = Array.isArray((data as { items?: unknown[] }).items)
        ? (data as { items: unknown[] }).items.filter(isRouteBookListItem)
        : []
      setRouteBookItems(rows)
    } catch {
      setRouteBookPickerError(label.addToRouteBookFailed)
    } finally {
      setRouteBookPickerLoading(false)
    }
  }, [label.addToRouteBookFailed, redirectToSignInForRouteBook])

  const openRouteBookPicker = useCallback(() => {
    if (!selectedPoint) {
      setLocateHint(label.routeBookPickOne)
      return
    }
    setRouteBookPickerOpen(true)
    setRouteBookTitleDraft('')
    void loadRouteBooks()
  }, [label.routeBookPickOne, loadRouteBooks, selectedPoint])

  const addSelectedPointToRouteBook = useCallback(
    async (routeBookId: string) => {
      if (!selectedPoint) return
      setRouteBookPickerSaving(true)
      setRouteBookPickerError(null)
      try {
        const res = await fetch(`/api/me/routebooks/${routeBookId}/points`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pointId: selectedPoint.id }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.status === 401) {
          setRouteBookPickerOpen(false)
          redirectToSignInForRouteBook()
          return
        }
        if (!res.ok) {
          setRouteBookPickerError(getApiErrorMessage(data) || label.addToRouteBookFailed)
          return
        }
        setLocateHint(label.addToRouteBookSuccess)
        setRouteBookPickerOpen(false)
      } catch {
        setRouteBookPickerError(label.addToRouteBookFailed)
      } finally {
        setRouteBookPickerSaving(false)
      }
    },
    [label.addToRouteBookFailed, label.addToRouteBookSuccess, redirectToSignInForRouteBook, selectedPoint]
  )

  const createRouteBookAndAddPoint = useCallback(async () => {
    const title = routeBookTitleDraft.trim()
    if (!title || !selectedPoint) return

    setRouteBookPickerSaving(true)
    setRouteBookPickerError(null)

    try {
      const createRes = await fetch('/api/me/routebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const createData = await createRes.json().catch(() => ({}))
      if (createRes.status === 401) {
        setRouteBookPickerOpen(false)
        redirectToSignInForRouteBook()
        return
      }
      if (!createRes.ok) {
        setRouteBookPickerError(getApiErrorMessage(createData) || label.addToRouteBookFailed)
        return
      }

      const createdRouteBookId = getRouteBookIdFromCreateResponse(createData)
      if (!createdRouteBookId) {
        setRouteBookPickerError(label.addToRouteBookFailed)
        return
      }

      const addRes = await fetch(`/api/me/routebooks/${createdRouteBookId}/points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointId: selectedPoint.id }),
      })
      const addData = await addRes.json().catch(() => ({}))
      if (!addRes.ok) {
        setRouteBookPickerError(getApiErrorMessage(addData) || label.addToRouteBookFailed)
        return
      }

      setLocateHint(label.routeBookCreatedAndAdded)
      setRouteBookPickerOpen(false)
      setRouteBookTitleDraft('')
    } catch {
      setRouteBookPickerError(label.addToRouteBookFailed)
    } finally {
      setRouteBookPickerSaving(false)
    }
  }, [label.addToRouteBookFailed, label.routeBookCreatedAndAdded, redirectToSignInForRouteBook, routeBookTitleDraft, selectedPoint])

  const switchToBangumiDetail = useCallback(() => {
    setDetailCardMode('bangumi')
    setSelectedPointId(null)
    setMobilePointPopupOpen(false)
    setMapViewMode('map')
  }, [])

  const tabs = bootstrap?.tabs || [
    { key: 'nearby' as const, label: label.nearby },
    { key: 'latest' as const, label: label.latest },
    { key: 'recent' as const, label: label.recent },
    { key: 'hot' as const, label: label.hot },
  ]
  const warmupReady = warmupProgress.percent >= 100
  const warmupActive = warmupProgress.phase === 'loading' && !warmupReady
  const warmupBlocking = warmupUiBlocking && warmupProgress.phase === 'loading' && !warmupReady
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
        <div className="pointer-events-none absolute right-4 top-[max(76px,env(safe-area-inset-top,0px)+52px)] z-40 w-[min(420px,calc(100%-1.25rem))]">
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
              percent={warmupProgress.percent}
              visible={warmupActive}
              title={warmupProgress.title}
              detail={warmupProgress.detail}
              className="pointer-events-none absolute right-4 top-[max(62px,env(safe-area-inset-top,0px)+42px)] z-30 w-[min(320px,calc(100%-1rem))]"
            />
            {mapViewMode === 'map' && (
              <>
                <MapModeToggle mode={mapMode} onModeChange={setMapMode} />
                {completeModeLoading && (
                  <div className="pointer-events-none absolute bottom-[52px] right-2 z-10 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 shadow-md backdrop-blur-sm">
                    <svg className="h-3.5 w-3.5 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-xs font-medium text-slate-600">加载图标中…</span>
                  </div>
                )}
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
