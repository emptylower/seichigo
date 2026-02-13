'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { AnitabiBangumiCard, AnitabiBangumiDTO, AnitabiBootstrapDTO, AnitabiChangelogDTO, AnitabiMapTab } from '@/lib/anitabi/types'

type Props = {
  locale: SupportedLocale
}

type MeState = {
  favorites: Array<{ targetKey: string }>
  history: Array<{ targetKey: string }>
}

type UrlState = {
  b: number | null
  p: string | null
  lng: number
  lat: number
  z: number
  tab: AnitabiMapTab
  q: string
}

type SearchResult = {
  bangumi: AnitabiBangumiCard[]
  points: Array<{ id: string; bangumiId: number; name: string }>
  cities: string[]
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
const DETAIL_PANEL_WIDTH = 340

type CameraPadding = {
  top: number
  right: number
  bottom: number
  left: number
}

type PointCoord = [number, number]

function parseNumberParam(value: string | null): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const L: Record<SupportedLocale, Record<string, string>> = {
  zh: {
    title: '巡礼地图',
    searchPlaceholder: '城市、作品、地标',
    latest: '最新更新',
    recent: '近期新作',
    hot: '热门作品',
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
    changelog: '更新记录',
    close: '关闭',
    loading: '加载中...',
    loadingMore: '正在加载更多作品…',
    loadedAll: '已加载全部作品',
    loadMoreFailed: '加载更多失败，请重试',
    retry: '重试',
    noData: '暂无可用数据',
    points: '地标',
    screenshots: '截图',
    share: '分享',
    openInGoogle: '谷歌导航',
    favorites: '收藏',
    selected: '当前作品',
    signInToFavorite: '登录后可收藏',
  },
  en: {
    title: 'Pilgrimage Map',
    searchPlaceholder: 'City, anime, or spot',
    latest: 'Latest Updates',
    recent: 'Recent Releases',
    hot: 'Trending',
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
    changelog: 'Changelog',
    close: 'Close',
    loading: 'Loading...',
    loadingMore: 'Loading more titles…',
    loadedAll: 'All titles loaded',
    loadMoreFailed: 'Failed to load more titles',
    retry: 'Retry',
    noData: 'No data yet',
    points: 'Points',
    screenshots: 'Shots',
    share: 'Share',
    openInGoogle: 'Google Nav',
    favorites: 'Favorite',
    selected: 'Selected',
    signInToFavorite: 'Sign in to favorite',
  },
  ja: {
    title: '巡礼マップ',
    searchPlaceholder: '都市・作品・スポット',
    latest: '最新更新',
    recent: '新着作品',
    hot: '人気作品',
    random: 'ランダム作品',
    locate: '現在地',
    locating: '現在地を取得中…',
    located: '現在地を取得済み',
    locateDenied: '位置情報の権限が拒否されました。ブラウザ設定をご確認ください',
    locateTimeout: '位置情報の取得がタイムアウトしました',
    locateUnavailable: 'この端末では位置情報を利用できません',
    locateInsecure: '位置情報には HTTPS または localhost が必要です',
    locateFailed: '位置情報の取得に失敗しました',
    mapNotReady: '地図の初期化が未完了です',
    changelog: '更新履歴',
    close: '閉じる',
    loading: '読み込み中...',
    loadingMore: '作品をさらに読み込み中…',
    loadedAll: 'すべての作品を読み込みました',
    loadMoreFailed: '追加読み込みに失敗しました',
    retry: '再試行',
    noData: 'データがありません',
    points: 'スポット',
    screenshots: '画像',
    share: '共有',
    openInGoogle: 'Google ナビ',
    favorites: 'お気に入り',
    selected: '選択中',
    signInToFavorite: 'ログインしてお気に入り',
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
      tab: 'latest',
      q: '',
    }
  }

  const params = new URLSearchParams(window.location.search)
  const b = parseNumberParam(params.get('b'))
  const lng = parseNumberParam(params.get('lng'))
  const lat = parseNumberParam(params.get('lat'))
  const z = parseNumberParam(params.get('z'))
  const tabRaw = params.get('tab')

  return {
    b: b && b > 0 ? b : null,
    p: params.get('p') || null,
    lng: lng ?? DEFAULT_VIEW.lng,
    lat: lat ?? DEFAULT_VIEW.lat,
    z: z && z > 0 ? z : DEFAULT_VIEW.z,
    tab: tabRaw === 'recent' || tabRaw === 'hot' ? tabRaw : 'latest',
    q: params.get('q') || '',
  }
}

function buildStyle(mode: 'street' | 'satellite'): maplibregl.StyleSpecification {
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

function geoLink(point: { geo: [number, number] | null }): string | null {
  if (!point.geo) return null
  return `https://www.google.com/maps?q=${point.geo[0]},${point.geo[1]}`
}

function matchPointId(candidateId: string, pointId: string): boolean {
  if (candidateId === pointId) return true
  if (pointId.includes(':')) return false
  return candidateId.endsWith(`:${pointId}`)
}

function collectPointCoords(points: AnitabiBangumiDTO['points']): PointCoord[] {
  return points
    .filter((point): point is typeof point & { geo: [number, number] } => Array.isArray(point.geo))
    .map((point) => [point.geo[1], point.geo[0]])
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI
}

function haversineMeters(a: PointCoord, b: PointCoord): number {
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

function buildCoverageCircle(points: PointCoord[]): GeoJSON.FeatureCollection<GeoJSON.Polygon> | null {
  if (!points.length) return null

  const [sumLng, sumLat] = points.reduce<[number, number]>(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1]],
    [0, 0]
  )
  const center: PointCoord = [sumLng / points.length, sumLat / points.length]

  let maxDistance = 0
  for (const point of points) {
    maxDistance = Math.max(maxDistance, haversineMeters(center, point))
  }

  const radiusMeters = Math.min(250000, Math.max(maxDistance * 1.2, points.length === 1 ? 420 : 700))
  const earthRadius = 6378137
  const angularDistance = radiusMeters / earthRadius
  const lat1 = toRadians(center[1])
  const lng1 = toRadians(center[0])
  const steps = 72
  const coordinates: PointCoord[] = []

  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * Math.PI * 2
    const sinLat2 = Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    const lat2 = Math.asin(Math.min(1, Math.max(-1, sinLat2)))
    const y = Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1)
    const x = Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    const lng2 = lng1 + Math.atan2(y, x)
    coordinates.push([toDegrees(lng2), toDegrees(lat2)])
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          radiusMeters,
          pointsLength: points.length,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [coordinates],
        },
      },
    ],
  }
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

function createPointMarkerElement(options: { color: string; selected: boolean; title: string }): HTMLButtonElement {
  const { color, selected, title } = options
  const marker = document.createElement('button')
  marker.type = 'button'
  marker.title = title
  marker.setAttribute('aria-label', title)
  marker.style.position = 'relative'
  marker.style.display = 'grid'
  marker.style.placeItems = 'center'
  marker.style.width = selected ? '30px' : '14px'
  marker.style.height = selected ? '30px' : '14px'
  marker.style.padding = '0'
  marker.style.border = 'none'
  marker.style.background = 'transparent'
  marker.style.cursor = 'pointer'
  marker.style.zIndex = selected ? '50' : '10'

  const core = document.createElement('span')
  core.style.display = 'block'
  core.style.width = selected ? '15px' : '12px'
  core.style.height = selected ? '15px' : '12px'
  core.style.borderRadius = '999px'
  core.style.border = selected ? '3px solid #ffffff' : '2px solid #ffffff'
  core.style.background = color
  core.style.boxShadow = selected ? '0 0 0 2px rgba(15,23,42,0.58), 0 10px 24px rgba(0,0,0,0.35)' : '0 1px 4px rgba(0,0,0,0.32)'
  marker.appendChild(core)

  if (selected) {
    const ring = document.createElement('span')
    ring.style.position = 'absolute'
    ring.style.inset = '0'
    ring.style.borderRadius = '999px'
    ring.style.border = `2px solid ${hexToRgba(color, 0.66)}`
    ring.style.boxShadow = `0 0 0 4px ${hexToRgba(color, 0.24)}`
    ring.style.pointerEvents = 'none'
    marker.appendChild(ring)

    const pulse = document.createElement('span')
    pulse.style.position = 'absolute'
    pulse.style.inset = '1px'
    pulse.style.borderRadius = '999px'
    pulse.style.background = hexToRgba(color, 0.25)
    pulse.style.pointerEvents = 'none'
    marker.appendChild(pulse)
    if (typeof pulse.animate === 'function') {
      pulse.animate([{ transform: 'scale(0.78)', opacity: 0.9 }, { transform: 'scale(1.34)', opacity: 0 }], {
        duration: 1350,
        iterations: Number.POSITIVE_INFINITY,
        easing: 'ease-out',
      })
    }
  }

  return marker
}

export default function AnitabiMapPageClient({ locale }: Props) {
  const label = L[locale]

  const parsed = useMemo(() => parseUrlState(), [])

  const mapRootRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const syncUrlRef = useRef<() => void>(() => undefined)
  const cardsContainerRef = useRef<HTMLDivElement | null>(null)
  const cardsLoadMoreRef = useRef<HTMLDivElement | null>(null)
  const cardFeedTokenRef = useRef(0)
  const focusTimerRef = useRef<number | null>(null)
  const rangeOverlayRef = useRef<{ data: GeoJSON.FeatureCollection<GeoJSON.Polygon>; color: string } | null>(null)

  const [tab, setTab] = useState<AnitabiMapTab>(parsed.tab)
  const [queryInput, setQueryInput] = useState(parsed.q)
  const [query, setQuery] = useState(parsed.q)
  const [selectedCity, setSelectedCity] = useState('')
  const [selectedBangumiId, setSelectedBangumiId] = useState<number | null>(parsed.b)
  const [selectedPointId, setSelectedPointId] = useState<string | null>(parsed.p)
  const [styleMode, setStyleMode] = useState<'street' | 'satellite'>('street')
  const [changelogOpen, setChangelogOpen] = useState(false)

  const [bootstrap, setBootstrap] = useState<AnitabiBootstrapDTO | null>(null)
  const [cards, setCards] = useState<AnitabiBangumiCard[]>([])
  const [detail, setDetail] = useState<AnitabiBangumiDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMoreCards, setLoadingMoreCards] = useState(false)
  const [cardsLoadError, setCardsLoadError] = useState<string | null>(null)
  const [hasMoreCards, setHasMoreCards] = useState(true)
  const [nextChunkIndex, setNextChunkIndex] = useState(1)
  const [detailLoading, setDetailLoading] = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult>({ bangumi: [], points: [], cities: [] })
  const [searchOpen, setSearchOpen] = useState(false)
  const [meState, setMeState] = useState<MeState | null>(null)
  const [meLoaded, setMeLoaded] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locateHint, setLocateHint] = useState<string | null>(null)

  const selectedPoint = useMemo(() => {
    if (!detail || !selectedPointId) return null
    return detail.points.find((point) => matchPointId(point.id, selectedPointId)) || null
  }, [detail, selectedPointId])

  const favoriteSet = useMemo(() => {
    return new Set((meState?.favorites || []).map((row) => row.targetKey))
  }, [meState])

  const getCameraPadding = useCallback((withDetailPanel: boolean): CameraPadding => {
    const map = mapRef.current
    const defaultTop = 56

    if (!map) {
      const sidePadding = withDetailPanel ? DETAIL_PANEL_WIDTH + 24 : 40
      return {
        top: defaultTop,
        right: sidePadding,
        bottom: withDetailPanel ? 120 : defaultTop,
        left: 40,
      }
    }

    const container = map.getContainer()
    const width = container.clientWidth
    const height = container.clientHeight
    const isDesktop = width >= 1024
    const rightPanel = withDetailPanel && isDesktop ? Math.min(Math.round(width * 0.42), DETAIL_PANEL_WIDTH + 24) : 28
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
      map.flyTo({
        center: [geo[1], geo[0]],
        zoom,
        offset,
        essential: true,
        duration: 780,
      })

      // A second short recenter solves occasional visual drift while map canvas is still settling.
      focusTimerRef.current = window.setTimeout(() => {
        const activeMap = mapRef.current
        if (!activeMap) return
        activeMap.easeTo({
          center: [geo[1], geo[0]],
          zoom: Math.max(activeMap.getZoom(), zoom),
          offset,
          essential: true,
          duration: 260,
        })
        focusTimerRef.current = null
      }, 360)

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

      if (focusTimerRef.current != null) {
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = null
      }

      map.resize()
      map.fitBounds(bounds, {
        padding: getCameraPadding(true),
        maxZoom: 12.8,
        duration: 840,
        essential: true,
      })
      return true
    },
    [getCameraPadding]
  )

  const syncRangeOverlay = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return false

    removeRangeLayer(map)

    const overlay = rangeOverlayRef.current
    if (!overlay) return true

    map.addSource(RANGE_SOURCE_ID, {
      type: 'geojson',
      data: overlay.data,
    })

    map.addLayer({
      id: RANGE_FILL_LAYER_ID,
      type: 'fill',
      source: RANGE_SOURCE_ID,
      paint: {
        'fill-color': hexToRgba(overlay.color, 0.16),
        'fill-opacity': 1,
      },
    })
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
    })

    return true
  }, [])

  const syncUrl = useCallback(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams()
    if (selectedBangumiId != null) params.set('b', String(selectedBangumiId))
    if (selectedPointId) params.set('p', selectedPointId)
    if (query) params.set('q', query)
    if (tab !== 'latest') params.set('tab', tab)

    const map = mapRef.current
    if (map) {
      const center = map.getCenter()
      params.set('lng', center.lng.toFixed(6))
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

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch(`/api/anitabi/me/state?locale=${encodeURIComponent(locale)}`, { method: 'GET' })
      if (res.status === 401) {
        setMeState(null)
        setMeLoaded(true)
        return
      }
      if (!res.ok) return
      const json = await res.json()
      setMeState({
        favorites: Array.isArray(json.favorites) ? json.favorites : [],
        history: Array.isArray(json.history) ? json.history : [],
      })
    } catch {
      // noop
    } finally {
      setMeLoaded(true)
    }
  }, [locale])

  const loadBootstrap = useCallback(async () => {
    const requestToken = cardFeedTokenRef.current + 1
    cardFeedTokenRef.current = requestToken
    setLoading(true)
    setLoadingMoreCards(false)
    setCardsLoadError(null)
    try {
      const params = new URLSearchParams()
      params.set('locale', locale)
      params.set('tab', tab)
      if (query) params.set('q', query)
      if (selectedCity) params.set('city', selectedCity)

      const res = await fetch(`/api/anitabi/bootstrap?${params.toString()}`, { method: 'GET' })
      if (!res.ok) throw new Error('Failed to load bootstrap')
      const json = (await res.json()) as AnitabiBootstrapDTO
      if (requestToken !== cardFeedTokenRef.current) return
      setBootstrap(json)
      setCards(json.cards)
      setNextChunkIndex(1)
      setHasMoreCards(json.cards.length >= CARD_PAGE_SIZE)
    } finally {
      if (requestToken !== cardFeedTokenRef.current) return
      setLoading(false)
    }
  }, [locale, query, selectedCity, tab])

  const loadMoreCards = useCallback(async () => {
    if (loading || loadingMoreCards || !hasMoreCards) return
    const requestToken = cardFeedTokenRef.current
    const params = new URLSearchParams()
    params.set('locale', locale)
    params.set('tab', tab)
    params.set('size', String(CARD_PAGE_SIZE))
    if (query) params.set('q', query)
    if (selectedCity) params.set('city', selectedCity)

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
  }, [hasMoreCards, label.loadMoreFailed, loading, loadingMoreCards, locale, nextChunkIndex, query, selectedCity, tab])

  const openBangumi = useCallback(
    async (id: number, pointId?: string | null) => {
      setSelectedBangumiId(id)
      setSelectedPointId(pointId || null)
      setDetailLoading(true)
      try {
        const res = await fetch(`/api/anitabi/bangumi/${id}?locale=${encodeURIComponent(locale)}`, { method: 'GET' })
        if (!res.ok) throw new Error('load detail failed')
        const json = (await res.json()) as AnitabiBangumiDTO
        setDetail(json)

        const map = mapRef.current
        if (map) {
          const geoPoints = collectPointCoords(json.points)

          if (pointId) {
            const target = json.points.find((point) => matchPointId(point.id, pointId))
            if (target && target.id !== pointId) {
              setSelectedPointId(target.id)
            }
            if (target?.geo) {
              focusGeo(target.geo, Math.max(map.getZoom(), 13.5), true)
            } else {
              fitBangumiBounds(geoPoints)
            }
          } else if (!fitBangumiBounds(geoPoints) && json.card.geo) {
            focusGeo(json.card.geo, json.card.zoom || 10, true)
          }
        }

        if (meLoaded) {
          fetch('/api/anitabi/me/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetType: 'bangumi', bangumiId: id }),
          }).catch(() => null)
        }
      } finally {
        setDetailLoading(false)
      }
    },
    [fitBangumiBounds, focusGeo, locale, meLoaded]
  )

  useEffect(() => {
    loadBootstrap().catch(() => null)
  }, [loadBootstrap])

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
    if (parsed.b) {
      openBangumi(parsed.b, parsed.p).catch(() => null)
    }
    loadMe().catch(() => null)
  }, [loadMe, openBangumi, parsed.b, parsed.p])

  useEffect(() => {
    const mapRoot = mapRootRef.current
    if (!mapRoot || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapRoot,
      style: buildStyle('street'),
      center: [parsed.lng, parsed.lat],
      zoom: parsed.z,
      pitchWithRotate: false,
      dragRotate: false,
      renderWorldCopies: true,
      dragPan: true,
      scrollZoom: true,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.on('moveend', () => syncUrlRef.current())

    const resizeMap = () => map.resize()
    map.once('load', () => {
      resizeMap()
      syncRangeOverlay()
    })
    const rafId = window.requestAnimationFrame(resizeMap)
    window.addEventListener('resize', resizeMap)

    mapRef.current = map

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resizeMap)
      if (focusTimerRef.current != null) {
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = null
      }
      for (const marker of markersRef.current) marker.remove()
      markersRef.current = []
      if (userMarkerRef.current) {
        userMarkerRef.current.remove()
        userMarkerRef.current = null
      }
      removeRangeLayer(map)
      map.remove()
      mapRef.current = null
    }
  }, [parsed.lat, parsed.lng, parsed.z, syncRangeOverlay])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.once('idle', () => {
      syncRangeOverlay()
    })
    map.setStyle(buildStyle(styleMode))
  }, [styleMode, syncRangeOverlay])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const marker of markersRef.current) marker.remove()
    markersRef.current = []

    if (!detail) return

    const color = detail.card.color || '#ec4899'

    for (const point of detail.points) {
      if (!point.geo) continue
      const isSelected = selectedPointId ? matchPointId(point.id, selectedPointId) : false
      const dot = createPointMarkerElement({
        color,
        selected: isSelected,
        title: point.name,
      })
      dot.addEventListener('click', () => {
        setSelectedPointId(point.id)
        fetch('/api/anitabi/me/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType: 'point', pointId: point.id }),
        }).catch(() => null)
      })

      const marker = new maplibregl.Marker({ element: dot }).setLngLat([point.geo[1], point.geo[0]]).addTo(map)
      markersRef.current.push(marker)
    }
  }, [detail, selectedPointId])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!detail) {
      rangeOverlayRef.current = null
      if (!syncRangeOverlay()) {
        map.once('idle', () => syncRangeOverlay())
      }
      return
    }

    const points = collectPointCoords(detail.points)
    const circle = buildCoverageCircle(points)
    rangeOverlayRef.current = circle
      ? {
          data: circle,
          color: detail.card.color || '#ec4899',
        }
      : null

    if (!syncRangeOverlay()) {
      map.once('idle', () => syncRangeOverlay())
    }
  }, [detail, syncRangeOverlay])

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

  const onSubmitQuery = useCallback(() => {
    setQuery(queryInput.trim())
    setSearchOpen(false)
  }, [queryInput])

  const onRandom = useCallback(() => {
    if (!cards.length) return
    const picked = cards[Math.floor(Math.random() * cards.length)]
    if (!picked) return
    openBangumi(picked.id).catch(() => null)
  }, [cards, openBangumi])

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

  const onLocate = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!window.isSecureContext) {
      setLocateHint(label.locateInsecure)
      return
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocateHint(label.locateUnavailable)
      return
    }

    setLocating(true)
    setLocateHint(null)

    const resolveSuccess = (position: GeolocationPosition) => {
      const map = mapRef.current
      if (!map) {
        setLocating(false)
        setLocateHint(label.mapNotReady)
        return
      }

      const { latitude, longitude, accuracy } = position.coords
      const zoom = accuracy <= 100 ? 15 : accuracy <= 500 ? 13 : 11
      focusGeo([latitude, longitude], zoom, false)
      paintUserMarker(longitude, latitude)
      setLocating(false)
      const acc = Number.isFinite(accuracy) ? Math.round(accuracy) : null
      setLocateHint(acc != null ? `${label.located} (±${acc}m)` : label.located)
    }

    const resolveError = (error: GeolocationPositionError, highAccuracy: boolean) => {
      if (highAccuracy && error.code !== error.PERMISSION_DENIED) {
        navigator.geolocation.getCurrentPosition(
          resolveSuccess,
          (error2) => {
            setLocating(false)
            if (error2.code === error2.PERMISSION_DENIED) {
              setLocateHint(label.locateDenied)
            } else if (error2.code === error2.TIMEOUT) {
              setLocateHint(label.locateTimeout)
            } else if (error2.code === error2.POSITION_UNAVAILABLE) {
              setLocateHint(label.locateUnavailable)
            } else {
              setLocateHint(label.locateFailed)
            }
          },
          {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 300000,
          }
        )
        return
      }

      setLocating(false)
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

  const onShare = useCallback(async () => {
    if (typeof window === 'undefined') return
    const href = window.location.href
    try {
      await navigator.clipboard.writeText(href)
    } catch {
      // ignore
    }
  }, [])

  const toggleFavorite = useCallback(
    async (payload: { targetType: 'bangumi' | 'point'; bangumiId?: number; pointId?: string }) => {
      if (!meLoaded || !meState) {
        const callback = encodeURIComponent(window.location.pathname + window.location.search)
        window.location.href = `/auth/signin?callbackUrl=${callback}`
        return
      }

      const targetKey = payload.targetType === 'bangumi' ? `bangumi:${payload.bangumiId}` : `point:${payload.pointId}`
      const remove = favoriteSet.has(targetKey)

      await fetch('/api/anitabi/me/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, remove }),
      })

      await loadMe()
    },
    [favoriteSet, loadMe, meLoaded, meState]
  )

  const tabs = bootstrap?.tabs || [
    { key: 'latest' as const, label: label.latest },
    { key: 'recent' as const, label: label.recent },
    { key: 'hot' as const, label: label.hot },
  ]

  return (
    <div data-layout-wide="true" className="h-[calc(100dvh-84px)] w-full overflow-hidden bg-slate-50">
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-white">
          <div className="space-y-3 border-b border-slate-200 px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-lg font-semibold text-slate-900">{label.title}</h1>
              <div className="flex items-center gap-1">
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  onClick={() => setStyleMode(styleMode === 'street' ? 'satellite' : 'street')}
                  type="button"
                >
                  {styleMode === 'street' ? '卫星' : '街道'}
                </button>
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={onLocate}
                  type="button"
                  disabled={locating}
                >
                  {locating ? label.locating : label.locate}
                </button>
                <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100" onClick={onRandom} type="button">
                  {label.random}
                </button>
              </div>
            </div>

            {locateHint ? <div className="text-xs text-slate-500">{locateHint}</div> : null}

            <div className="relative">
              <div className="flex gap-2">
                <input
                  value={queryInput}
                  onFocus={() => setSearchOpen(true)}
                  onChange={(e) => setQueryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSubmitQuery()
                  }}
                  placeholder={label.searchPlaceholder}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400"
                />
                <button className="rounded-md bg-brand-500 px-3 py-2 text-xs font-medium text-white hover:bg-brand-600" onClick={onSubmitQuery} type="button">
                  搜索
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
                      城市：{city}
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
                      作品：{item.title}
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
                      地标：{point.name}
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
                全部
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
              <button className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100" type="button" onClick={() => setChangelogOpen((v) => !v)}>
                {label.changelog}
              </button>
            </div>
          </div>

          <div ref={cardsContainerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {loading ? <div className="text-sm text-slate-500">{label.loading}</div> : null}
            {!loading && cards.length === 0 ? <div className="text-sm text-slate-500">{label.noData}</div> : null}
            <div className="space-y-3">
              {cards.map((card) => {
                const swatchColor = card.color || '#ec4899'
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
                  >
                    <div className="h-1 w-full" style={{ background: swatchColor, opacity: selectedBangumiId === card.id ? 0.95 : 0.58 }} />
                    <div className="flex items-start gap-3 p-3">
                      <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                        {card.cover ? (
                          <img src={card.cover} alt={card.title} className="h-full w-full object-cover" loading="lazy" />
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
          </div>
        </aside>

        <section className="relative h-full min-h-0">
          <div ref={mapRootRef} className="h-full w-full" />

          <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex justify-end gap-2">
            <button className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-xs text-slate-700 shadow hover:bg-white" type="button" onClick={onShare}>
              {label.share}
            </button>
          </div>

          {detail ? (
            <div className="absolute right-4 top-14 z-20 max-h-[calc(100%-80px)] w-[340px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <div>
                  <div className="line-clamp-1 text-sm font-semibold text-slate-900">{detail.card.title}</div>
                  <div className="text-xs text-slate-500">{detail.card.city || '-'} · {detail.points.length} {label.points}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                    onClick={() => toggleFavorite({ targetType: 'bangumi', bangumiId: detail.card.id }).catch(() => null)}
                    title={meState ? label.favorites : label.signInToFavorite}
                  >
                    {favoriteSet.has(`bangumi:${detail.card.id}`) ? '★' : '☆'}
                  </button>
                  <button type="button" className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100" onClick={() => setDetail(null)}>
                    {label.close}
                  </button>
                </div>
              </div>

              {selectedPoint ? (
                <div className="space-y-2 border-b border-slate-200 px-3 py-3">
                  <div className="text-sm font-medium text-slate-900">{selectedPoint.name}</div>
                  {selectedPoint.image ? <img src={selectedPoint.image} alt={selectedPoint.name} className="h-40 w-full rounded-md object-cover" /> : null}
                  <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
                    {selectedPoint.ep ? <span>EP {selectedPoint.ep}</span> : null}
                    {selectedPoint.s ? <span>· {selectedPoint.s}</span> : null}
                    {selectedPoint.origin ? <span>· {selectedPoint.origin}</span> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {geoLink(selectedPoint) ? (
                      <a className="rounded bg-slate-900 px-2 py-1 text-xs text-white no-underline hover:bg-slate-700" href={geoLink(selectedPoint) || '#'} target="_blank" rel="noreferrer">
                        {label.openInGoogle}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                      onClick={() => toggleFavorite({ targetType: 'point', pointId: selectedPoint.id }).catch(() => null)}
                    >
                      {favoriteSet.has(`point:${selectedPoint.id}`) ? '★' : '☆'} {label.favorites}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="max-h-[420px] overflow-auto px-3 py-2">
                {detailLoading ? <div className="py-4 text-sm text-slate-500">{label.loading}</div> : null}
                <div className="space-y-1">
                  {detail.points.map((point) => (
                    <button
                      key={point.id}
                      type="button"
                      className={`block w-full rounded px-2 py-1.5 text-left text-xs ${selectedPoint?.id === point.id ? 'bg-brand-100 text-brand-800' : 'text-slate-700 hover:bg-slate-100'}`}
                      onClick={() => {
                        setSelectedPointId(point.id)
                        if (point.geo && mapRef.current) {
                          focusGeo(point.geo, Math.max(mapRef.current.getZoom(), 13.5), true)
                        }
                      }}
                    >
                      <span className="font-medium">{point.name}</span>
                      {point.ep ? <span className="ml-1 text-slate-500">EP {point.ep}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {changelogOpen ? (
            <div className="absolute bottom-4 left-4 z-20 max-h-[45vh] w-[360px] overflow-auto rounded-xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">{label.changelog}</h2>
                <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" onClick={() => setChangelogOpen(false)}>
                  {label.close}
                </button>
              </div>
              <div className="space-y-3 text-xs text-slate-700">
                {(bootstrap?.changelog || []).map((item: AnitabiChangelogDTO) => (
                  <div key={item.id} className="rounded-md border border-slate-200 bg-white p-2">
                    <div className="mb-1 text-[11px] text-slate-500">{item.date}</div>
                    <div className="mb-1 font-medium text-slate-900">{item.title}</div>
                    <div className="whitespace-pre-wrap leading-relaxed text-slate-700">{item.body}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
