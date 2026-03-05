import maplibregl from 'maplibre-gl'
import type { SupportedLocale } from '@/lib/i18n/types'
import type {
  AnitabiBangumiCard,
  AnitabiBangumiDTO,
  AnitabiBootstrapDTO,
  AnitabiMapTab,
} from '@/lib/anitabi/types'

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
const WARMUP_PRELOAD_FETCH_TIMEOUT_MS = 12000
const WARMUP_ACTIVE_DETAIL_IMAGE_MAX = 120
const WARMUP_MAP_WAIT_TIMEOUT_MS = 12000
const WARMUP_MAP_READY_TIMEOUT_MS = 15000
const WARMUP_WATCHDOG_INTERVAL_MS = 3000
const WARMUP_STALL_WARN_MS = 10000
const COMPLETE_MODE_SPRITE_MAX_BANGUMI = 220
const COMPLETE_MODE_SPRITE_BUDGET_MS = 9000
const COMPLETE_MODE_COVER_CANDIDATES_MAX = 120
const COMPLETE_MODE_COVER_MAX_LOADED = 96
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
const MAP_STYLE_MISSING_IMAGE_FALLBACK_MAX = 256

function shouldSkipMissingStyleImageFallback(imageId: string): boolean {
  return imageId.startsWith('sprite-') || imageId.startsWith('cover-') || imageId.startsWith('thumb-')
}

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

type WarmupMetricValue = number | string
type WarmupMetrics = Record<string, WarmupMetricValue>

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
const COMPLETE_AVATAR_MAX_ZOOM = 13
const COMPLETE_DETAIL_THEME_MIN_ZOOM = 15.8
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

function resolveImageBuildZoom(panoramaZoom: number): number {
  if (!Number.isFinite(panoramaZoom)) return 17.5
  return Math.max(16.8, panoramaZoom - 0.9)
}

function resolveImageShowZoom(panoramaZoom: number): number {
  if (!Number.isFinite(panoramaZoom)) return 17.9
  return Math.max(17.2, panoramaZoom - 0.5)
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
    preloadIconsTitle: '正在处理地图图标',
    preloadIconsDetail: '图标渲染中，请稍候…',
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
    preloadIconsTitle: 'Preparing map icons',
    preloadIconsDetail: 'Rendering marker icons, please wait…',
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
    preloadIconsTitle: '地図アイコンを準備中',
    preloadIconsDetail: 'マーカーアイコンを描画中です…',
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


export {
  BANGUMI_CACHE_MAX, bangumiDetailCache, cachePut, POINT_IMAGE_PREFETCH_LIMIT, POINT_IMAGE_PREFETCH_CACHE_MAX,
  prefetchedPointImageUrls, prefetchingPointImageUrls, NON_NEARBY_TABS, WARMUP_BLOCKING_BUDGET_MS, PRELOAD_CHUNK_CONCURRENCY,
  PRELOAD_IMAGE_BLOCKING_MAX, PRELOAD_IMAGE_BACKGROUND_MAX, PRELOAD_IMAGE_BLOCKING_BASE_CONCURRENCY, PRELOAD_IMAGE_BACKGROUND_CONCURRENCY,
  WARMUP_IMAGE_TIMEOUT_MS, WARMUP_PRELOAD_FETCH_TIMEOUT_MS, WARMUP_ACTIVE_DETAIL_IMAGE_MAX, WARMUP_MAP_WAIT_TIMEOUT_MS, WARMUP_MAP_READY_TIMEOUT_MS,
  WARMUP_WATCHDOG_INTERVAL_MS, WARMUP_STALL_WARN_MS, COMPLETE_MODE_SPRITE_MAX_BANGUMI, COMPLETE_MODE_SPRITE_BUDGET_MS,
  COMPLETE_MODE_COVER_CANDIDATES_MAX, COMPLETE_MODE_COVER_MAX_LOADED, WARMUP_TASK_WEIGHTS, MAP_PRELOAD_V2_ENABLED, MAP_VECTOR_ENABLED,
  MAPTILER_KEY, MAPBOX_TOKEN, STADIA_KEY, MAP_STYLE_PROVIDER_ORDER, MAP_STYLE_FAILOVER_TIMEOUT_MS, MAP_STYLE_FAILOVER_ERROR_BURST_WINDOW_MS,
  MAP_STYLE_FAILOVER_ERROR_BURST_THRESHOLD, MAP_STYLE_MISSING_IMAGE_FALLBACK_MAX, shouldSkipMissingStyleImageFallback, createEmptyWarmupTaskProgress,
  isValidLatLng, resolveLocateZoom, readStoredUserLocation, readStoredUserLocationRaw, writeStoredUserLocation, hasSeenPointPoolHint, markPointPoolHintSeen,
  queryGeolocationPermissionState, parseNumberParam, isRouteBookListItem, getApiErrorMessage, getRouteBookIdFromCreateResponse, normalizeSearchKeyword,
  filterBulkCardsBySearch, L, DEFAULT_VIEW, CARD_PAGE_SIZE, CARD_LIST_PREFETCH_ROOT_MARGIN, RANGE_SOURCE_ID, RANGE_FILL_LAYER_ID, RANGE_LINE_LAYER_ID,
  POINT_SOURCE_ID, POINT_LAYER_ID, POINT_SELECTED_HALO_LAYER_ID, POINT_SELECTED_LAYER_ID, DETAIL_PANEL_WIDTH, DESKTOP_BREAKPOINT,
  CLUSTER_JOIN_DISTANCE_MIN_METERS, CLUSTER_JOIN_DISTANCE_MAX_METERS, CLUSTER_JOIN_DISTANCE_SCALE, PANORAMA_TRIGGER_ZOOM,
  COMPLETE_AVATAR_MAX_ZOOM, COMPLETE_DETAIL_THEME_MIN_ZOOM, resolveImageBuildZoom, resolveImageShowZoom,
  USER_LOCATION_STORAGE_KEY, POINT_POOL_HINT_SEEN_STORAGE_KEY, LOCATION_DIALOG_DISMISSED_KEY,
}

export type {
  WarmupProgress, WarmupTaskKey, WarmupTaskProgress, WarmupMetricValue, WarmupMetrics, Props, PointState, MeState, UrlState,
  UserLocation, SearchResult, RouteBookStatus, RouteBookListItem, CameraPadding, PointCoord, PointFeatureProperties,
  PanoramaEmbed, MapStyleMode, MapStyleProvider, MapStyleCandidate,
}
