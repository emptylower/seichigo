'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { AnitabiBangumiCard, AnitabiBangumiDTO, AnitabiBootstrapDTO, AnitabiChangelogDTO, AnitabiMapTab } from '@/lib/anitabi/types'
import { extractLatLngFromGoogleMapsUrl } from '@/lib/route/google'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'

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
const GOOGLE_STREET_VIEW_EMBED_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY || ''

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
}

type PanoramaEmbed = {
  provider: 'google'
  location: { lat: number; lng: number }
} | {
  provider: 'mapillary'
  src: string
}

function parseNumberParam(value: string | null): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

type GoogleMapsApi = {
  maps: {
    StreetViewPanorama: new (container: HTMLElement, opts?: Record<string, unknown>) => {
      setPosition: (latLng: unknown) => void
      setPov: (pov: { heading: number; pitch: number }) => void
      setVisible: (visible: boolean) => void
    }
    StreetViewService: new () => {
      getPanorama: (
        request: { location: { lat: number; lng: number }; radius?: number },
        callback: (data: any, status: string) => void
      ) => void
    }
    StreetViewStatus: {
      OK: string
    }
    event?: {
      trigger: (instance: unknown, eventName: string) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleMapsApi
    __seichigoGoogleMapsLoadPromise?: Promise<GoogleMapsApi>
  }
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
    enterPanorama: '进入全景',
    exitPanorama: '退出全景',
    panoramaLoading: '全景加载中…',
    panoramaUnavailable: '该点位暂无可用全景',
    panoramaLoadFailed: '全景加载失败，请稍后重试',
    favorites: '收藏',
    selected: '当前作品',
    signInToFavorite: '登录后可收藏',
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
    enterPanorama: 'Enter Panorama',
    exitPanorama: 'Exit Panorama',
    panoramaLoading: 'Loading panorama…',
    panoramaUnavailable: 'Panorama is unavailable for this point',
    panoramaLoadFailed: 'Failed to load panorama, please retry',
    favorites: 'Favorite',
    selected: 'Selected',
    signInToFavorite: 'Sign in to favorite',
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
    enterPanorama: '全景を表示',
    exitPanorama: '全景を閉じる',
    panoramaLoading: '全景を読み込み中…',
    panoramaUnavailable: 'このスポットでは全景を利用できません',
    panoramaLoadFailed: '全景の読み込みに失敗しました',
    favorites: 'お気に入り',
    selected: '選択中',
    signInToFavorite: 'ログインしてお気に入り',
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

function resolvePanoramaLocation(point: { geo: [number, number] | null; originLink?: string | null }): { lat: number; lng: number } | null {
  if (isValidGeoPair(point.geo)) {
    return { lat: point.geo[0], lng: point.geo[1] }
  }
  if (!point.originLink) return null
  return extractLatLngFromGoogleMapsUrl(point.originLink)
}

function loadGoogleMapsApi(apiKey: string): Promise<GoogleMapsApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps API only works in browser'))
  }

  const key = apiKey.trim()
  if (!key) {
    return Promise.reject(new Error('Missing Google Maps API key'))
  }

  if (window.google?.maps?.StreetViewPanorama) {
    return Promise.resolve(window.google)
  }

  if (window.__seichigoGoogleMapsLoadPromise) {
    return window.__seichigoGoogleMapsLoadPromise
  }

  window.__seichigoGoogleMapsLoadPromise = new Promise<GoogleMapsApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`
    script.async = true
    script.onload = () => {
      if (window.google?.maps?.StreetViewPanorama) {
        resolve(window.google)
      } else {
        reject(new Error('Google Maps API loaded but Street View is unavailable'))
      }
    }
    script.onerror = () => {
      reject(new Error('Failed to load Google Maps API script'))
    }
    document.head.appendChild(script)
  }).catch((error) => {
    delete window.__seichigoGoogleMapsLoadPromise
    throw error
  })

  return window.__seichigoGoogleMapsLoadPromise
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
  if (location && GOOGLE_STREET_VIEW_EMBED_KEY.trim()) {
    return { provider: 'google', location }
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
  selectedPointId: string | null
): GeoJSON.FeatureCollection<GeoJSON.Point, PointFeatureProperties> {
  const color = detail.card.color || '#6d28d9'
  const features: Array<GeoJSON.Feature<GeoJSON.Point, PointFeatureProperties>> = []

  for (const point of detail.points) {
    if (!isValidGeoPair(point.geo)) continue
    features.push({
      type: 'Feature',
      properties: {
        pointId: point.id,
        color,
        selected: selectedPointId && matchPointId(point.id, selectedPointId) ? 1 : 0,
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

export default function AnitabiMapPageClient({ locale }: Props) {
  const label = L[locale]

  const parsed = useMemo(() => parseUrlState(), [])

  const mapRootRef = useRef<HTMLDivElement | null>(null)
  const panoramaRootRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const googleStreetViewRef = useRef<{
    panorama: {
      setPosition: (latLng: unknown) => void
      setPov: (pov: { heading: number; pitch: number }) => void
      setVisible: (visible: boolean) => void
    }
    service: {
      getPanorama: (
        request: { location: { lat: number; lng: number }; radius?: number },
        callback: (data: any, status: string) => void
      ) => void
    }
    statusOk: string
  } | null>(null)
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const syncUrlRef = useRef<() => void>(() => undefined)
  const syncPointLayerRef = useRef<() => boolean>(() => false)
  const detailRef = useRef<AnitabiBangumiDTO | null>(null)
  const cardsContainerRef = useRef<HTMLDivElement | null>(null)
  const cardsLoadMoreRef = useRef<HTMLDivElement | null>(null)
  const cardFeedTokenRef = useRef(0)
  const focusTimerRef = useRef<number | null>(null)
  const rangeOverlayRef = useRef<{ data: GeoJSON.FeatureCollection<GeoJSON.Polygon>; color: string } | null>(null)
  const isDesktopRef = useRef(true)
  const selectedPointIdRef = useRef<string | null>(parsed.p)
  const autoPanoramaDismissedRef = useRef(false)
  const panoramaProgressTimerRef = useRef<number | null>(null)
  const panoramaProgressDoneTimerRef = useRef<number | null>(null)

  const [tab, setTab] = useState<AnitabiMapTab>(parsed.tab)
  const [queryInput, setQueryInput] = useState(parsed.q)
  const [query, setQuery] = useState(parsed.q)
  const [selectedCity, setSelectedCity] = useState('')
  const [selectedBangumiId, setSelectedBangumiId] = useState<number | null>(parsed.b)
  const [selectedPointId, setSelectedPointId] = useState<string | null>(parsed.p)
  const [styleMode, setStyleMode] = useState<'street' | 'satellite'>('street')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.innerWidth >= DESKTOP_BREAKPOINT
  })
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
  const [mobilePointPopupOpen, setMobilePointPopupOpen] = useState(false)

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
  const [mapZoom, setMapZoom] = useState(parsed.z)
  const [mapViewMode, setMapViewMode] = useState<'map' | 'panorama'>('map')
  const [panoramaError, setPanoramaError] = useState<string | null>(null)
  const [panoramaLoading, setPanoramaLoading] = useState(false)
  const [panoramaProgress, setPanoramaProgress] = useState(0)

  const selectedPoint = useMemo(() => {
    if (!detail || !selectedPointId) return null
    return detail.points.find((point) => matchPointId(point.id, selectedPointId)) || null
  }, [detail, selectedPointId])

  const selectedPointPanorama = useMemo(() => {
    if (!selectedPoint) return null
    return resolvePanoramaEmbed(selectedPoint)
  }, [selectedPoint])

  const favoriteSet = useMemo(() => {
    return new Set((meState?.favorites || []).map((row) => row.targetKey))
  }, [meState])

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
      googleStreetViewRef.current?.panorama.setVisible(false)
      return
    }

    if (!selectedPointPanorama) {
      setPanoramaError(label.panoramaUnavailable)
      failPanoramaProgress()
      return
    }

    let cancelled = false
    setPanoramaError(null)
    startPanoramaProgress()

    if (selectedPointPanorama.provider !== 'google') {
      googleStreetViewRef.current?.panorama.setVisible(false)
      return () => {
        cancelled = true
      }
    }

    const root = panoramaRootRef.current
    if (!root) {
      setPanoramaError(label.panoramaLoadFailed)
      failPanoramaProgress()
      return
    }

    loadGoogleMapsApi(GOOGLE_STREET_VIEW_EMBED_KEY)
      .then((google) => {
        if (cancelled) return

        if (!googleStreetViewRef.current) {
          googleStreetViewRef.current = {
            panorama: new google.maps.StreetViewPanorama(root, {
              addressControl: true,
              fullscreenControl: false,
              motionTracking: false,
              showRoadLabels: true,
              zoomControl: true,
              disableDefaultUI: false,
            }),
            service: new google.maps.StreetViewService(),
            statusOk: google.maps.StreetViewStatus.OK,
          }
        }

        const runtime = googleStreetViewRef.current
        const fallbackLocation = selectedPointPanorama.location

        runtime.service.getPanorama(
          { location: fallbackLocation, radius: 120 },
          (data: any, status: string) => {
            if (cancelled) return

            const streetView = runtime.panorama
            if (status === runtime.statusOk && data?.location?.latLng) {
              streetView.setPosition(data.location.latLng)
              if (typeof data?.tiles?.centerHeading === 'number') {
                streetView.setPov({ heading: data.tiles.centerHeading, pitch: 0 })
              }
              streetView.setVisible(true)
              setPanoramaError(null)
              window.requestAnimationFrame(() => {
                if (cancelled) return
                google.maps.event?.trigger(streetView as unknown, 'resize')
                window.requestAnimationFrame(() => {
                  if (cancelled) return
                  google.maps.event?.trigger(streetView as unknown, 'resize')
                })
              })
              finishPanoramaProgress()
              return
            }

            streetView.setVisible(false)
            setPanoramaError(label.panoramaUnavailable)
            failPanoramaProgress()
          }
        )
      })
      .catch(() => {
        if (cancelled) return
        setPanoramaError(label.panoramaLoadFailed)
        failPanoramaProgress()
      })

    return () => {
      cancelled = true
    }
  }, [
    failPanoramaProgress,
    finishPanoramaProgress,
    label.panoramaLoadFailed,
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

  const syncPointLayer = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return false

    removePointLayer(map)
    if (!detail) return true

    const data = buildPointFeatureCollection(detail, selectedPointId)
    map.addSource(POINT_SOURCE_ID, {
      type: 'geojson',
      data,
    })

    map.addLayer({
      id: POINT_LAYER_ID,
      type: 'circle',
      source: POINT_SOURCE_ID,
      paint: {
        'circle-color': ['coalesce', ['get', 'color'], '#6d28d9'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3.4, 8, 5.4, 12, 6.8],
        'circle-stroke-color': '#ffffff',
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
        'circle-color': ['coalesce', ['get', 'color'], '#6d28d9'],
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
        'circle-color': ['coalesce', ['get', 'color'], '#6d28d9'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 8, 7.2, 12, 8.8],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 1.8, 12, 2.6],
        'circle-opacity': 0.98,
      },
    })

    return true
  }, [detail, selectedPointId])

  useEffect(() => {
    syncPointLayerRef.current = syncPointLayer
  }, [syncPointLayer])

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

  useEffect(() => {
    detailRef.current = detail
  }, [detail])

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
      setMapViewMode('map')
      if (!isDesktop) {
        setMobilePointPopupOpen(false)
        setMobilePanelOpen(false)
      }
      setDetailLoading(true)
      try {
        const res = await fetch(`/api/anitabi/bangumi/${id}?locale=${encodeURIComponent(locale)}`, { method: 'GET' })
        if (!res.ok) throw new Error('load detail failed')
        const json = (await res.json()) as AnitabiBangumiDTO
        setDetail(json)

        const map = mapRef.current
        if (map) {
          const geoPoints = collectPointCoords(json.points)
          const focusCluster = pickFocusCluster(geoPoints)
          const focusPoints = focusCluster.length ? focusCluster : geoPoints

          if (pointId) {
            const target = json.points.find((point) => matchPointId(point.id, pointId))
            if (target && target.id !== pointId) {
              setSelectedPointId(target.id)
            }
            if (target?.geo) {
              focusGeo(target.geo, Math.max(map.getZoom(), 13.5), true)
            } else {
              fitBangumiBounds(focusPoints)
            }
          } else if (focusPoints.length >= 2) {
            fitBangumiBounds(focusPoints)
          } else if (focusPoints.length === 1) {
            const single = focusPoints[0]!
            focusGeo([single[1], single[0]], Math.max(map.getZoom(), 12.8), true)
          } else if (json.card.geo) {
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
    [fitBangumiBounds, focusGeo, isDesktop, locale, meLoaded]
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
      fetch('/api/anitabi/me/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'point', pointId }),
      }).catch(() => null)
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
    map.once('load', () => {
      resizeMap()
      syncPointLayerRef.current()
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
      removePointLayer(map)
      removeRangeLayer(map)
      map.remove()
      mapRef.current = null
    }
  }, [focusGeo, parsed.lat, parsed.lng, parsed.z, syncRangeOverlay])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.once('idle', () => {
      syncPointLayerRef.current()
      syncRangeOverlay()
    })
    map.setStyle(buildStyle(styleMode))
  }, [styleMode, syncRangeOverlay])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!syncPointLayer()) {
      map.once('idle', () => syncPointLayer())
    }
  }, [syncPointLayer])

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
    setSearchOpen(false)
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

  const detailPanelInner = detail ? (
    <>
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
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
            onClick={() => {
              setDetail(null)
              setMobilePointPopupOpen(false)
              setMapViewMode('map')
            }}
          >
            {label.close}
          </button>
        </div>
      </div>

      {selectedPoint ? (
        <div className="space-y-2 border-b border-slate-200 px-3 py-3">
          <div className="text-sm font-medium text-slate-900">{selectedPoint.name}</div>
          {selectedPoint.image ? (
            <img
              src={selectedPoint.image}
              alt={selectedPoint.name}
              width={640}
              height={360}
              className="h-40 w-full rounded-md object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : null}
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
              className="rounded bg-brand-500 px-2 py-1 text-xs text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-55"
              onClick={enterPanorama}
              disabled={!selectedPointPanorama}
              title={selectedPointPanorama ? undefined : label.panoramaUnavailable}
            >
              {label.enterPanorama}
            </button>
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
                if (!isDesktopRef.current) setMobilePointPopupOpen(false)
                if (mapViewMode === 'panorama') return
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
    </>
  ) : null

  const changelogPanelInner = changelogOpen ? (
    <>
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
        <button className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100" type="button" onClick={() => setChangelogOpen((v) => !v)}>
          {label.changelog}
        </button>
      </div>
    </div>
  )

  const cardsList = (
    <>
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
                    <img src={card.cover} alt={card.title} width={96} height={128} className="h-full w-full object-cover" loading="lazy" decoding="async" />
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
    </>
  )

  const mobilePointPopup = !isDesktop && !mobilePanelOpen && mobilePointPopupOpen && selectedPoint ? (
    <div className="pointer-events-none absolute inset-x-3 z-30" style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}>
      <div className="pointer-events-auto mx-auto max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{selectedPoint.name}</h3>
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
            onClick={() => setMobilePointPopupOpen(false)}
          >
            {label.close}
          </button>
        </div>
        <div className="space-y-2 px-3 py-3">
          {selectedPoint.image ? (
            <img
              src={selectedPoint.image}
              alt={selectedPoint.name}
              width={640}
              height={360}
              className="h-40 w-full rounded-md object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : null}
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
              className="rounded bg-brand-500 px-2 py-1 text-xs text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-55"
              onClick={enterPanorama}
              disabled={!selectedPointPanorama}
              title={selectedPointPanorama ? undefined : label.panoramaUnavailable}
            >
              {label.enterPanorama}
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
              onClick={() => toggleFavorite({ targetType: 'point', pointId: selectedPoint.id }).catch(() => null)}
            >
              {favoriteSet.has(`point:${selectedPoint.id}`) ? '★' : '☆'} {label.favorites}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div data-layout-wide="true" className="h-[calc(100dvh-84px)] w-full overflow-hidden bg-slate-50">
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
              className={`absolute inset-0 transition-opacity duration-200 ${
                mapViewMode === 'map' ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            />
            <div
              className={`absolute inset-0 bg-black transition-opacity duration-200 ${
                mapViewMode === 'panorama' ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              {mapViewMode === 'panorama' ? (
                selectedPointPanorama ? (
                  selectedPointPanorama.provider === 'google' ? (
                    <>
                      <div ref={panoramaRootRef} className="h-full w-full" />
                      {panoramaError ? (
                        <div className="pointer-events-none absolute inset-x-6 bottom-6 z-10 rounded-md bg-black/60 px-3 py-2 text-center text-xs text-white/90">
                          {panoramaError}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <iframe
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
                      {panoramaError ? (
                        <div className="pointer-events-none absolute inset-x-6 bottom-6 z-10 rounded-md bg-black/60 px-3 py-2 text-center text-xs text-white/90">
                          {panoramaError}
                        </div>
                      ) : null}
                    </>
                  )
                ) : (
                  <div className="grid h-full w-full place-items-center px-6 text-center text-sm text-white/85">
                    {label.panoramaUnavailable}
                  </div>
                )
              ) : null}
              {mapViewMode === 'panorama' && panoramaLoading ? (
                <div className="pointer-events-none absolute inset-x-6 top-6 z-20 rounded-md bg-black/65 px-3 py-2">
                  <div className="mb-1 text-[11px] text-white/90">{label.panoramaLoading}</div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/25">
                    <div
                      className="h-full rounded-full bg-brand-400 transition-[width] duration-200 ease-out"
                      style={{ width: `${panoramaProgress}%` }}
                    />
                  </div>
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
            <button className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-xs text-slate-700 shadow hover:bg-white" type="button" onClick={onShare}>
              {label.share}
            </button>
          </div>

          {mobilePointPopup}

          {!isDesktop ? (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-30 flex justify-center mobile-safe-bottom">
              <button
                type="button"
                onClick={() => setMobilePanelOpen(true)}
                className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 text-sm font-medium text-slate-700 shadow-lg backdrop-blur hover:bg-white"
              >
                <span>{detail ? `${label.selected} · ${detail.card.title}` : label.openPanel}</span>
              </button>
            </div>
          ) : null}

          {isDesktop && detailPanelInner ? (
            <div className="absolute right-4 top-14 z-20 max-h-[calc(100%-80px)] w-[340px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
              {detailPanelInner}
            </div>
          ) : null}

          {isDesktop && changelogPanelInner ? (
            <div className="absolute bottom-4 left-4 z-20 max-h-[45vh] w-[360px] overflow-auto rounded-xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur">
              {changelogPanelInner}
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
                {changelogPanelInner ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    {changelogPanelInner}
                  </div>
                ) : null}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}
