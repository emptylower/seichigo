import maplibregl from 'maplibre-gl'
import type {
  AnitabiBangumiCard,
  AnitabiBangumiDTO,
  AnitabiPreloadChunkItemDTO,
} from '@/lib/anitabi/types'
import { extractLatLngFromGoogleMapsUrl } from '@/lib/route/google'
import {
  DEFAULT_VIEW,
  MAP_STYLE_PROVIDER_ORDER,
  MAP_VECTOR_ENABLED,
  MAPBOX_TOKEN,
  MAPTILER_KEY,
  POINT_IMAGE_PREFETCH_CACHE_MAX,
  POINT_IMAGE_PREFETCH_LIMIT,
  PRELOAD_IMAGE_BACKGROUND_CONCURRENCY,
  PRELOAD_IMAGE_BLOCKING_BASE_CONCURRENCY,
  STADIA_KEY,
  WARMUP_IMAGE_TIMEOUT_MS,
  parseNumberParam,
  prefetchedPointImageUrls,
  prefetchingPointImageUrls,
} from './shared'
import type {
  MapStyleCandidate,
  MapStyleMode,
  MapStyleProvider,
  MeState,
  PanoramaEmbed,
  PointCoord,
  PointFeatureProperties,
  UrlState,
} from './shared'
import { toMapDisplayImageUrl } from '@/lib/anitabi/imageProxy'

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

function normalizePointInlineImageUrl(input: string | null | undefined): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null

  try {
    return toMapDisplayImageUrl(raw, { kind: 'point-thumbnail' })
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

function createRequestSignalWithTimeout(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const safeTimeout = Math.max(1000, timeoutMs)
  const timer = window.setTimeout(() => {
    controller.abort()
  }, safeTimeout)

  const onParentAbort = () => {
    controller.abort()
  }

  if (parent) {
    if (parent.aborted) {
      controller.abort()
    } else {
      parent.addEventListener('abort', onParentAbort, { once: true })
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer)
      if (parent) parent.removeEventListener('abort', onParentAbort)
    },
  }
}

function withPromiseTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const finish = (value: T) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const timer = window.setTimeout(() => {
      finish(fallback)
    }, Math.max(300, timeoutMs))

    const onAbort = () => {
      window.clearTimeout(timer)
      finish(fallback)
    }

    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    void promise
      .then((value) => {
        window.clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
        finish(value)
      })
      .catch(() => {
        window.clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
        finish(fallback)
      })
  })
}

function yieldToMainThread(signal?: AbortSignal): Promise<void> {
  if (typeof window === 'undefined' || signal?.aborted) return Promise.resolve()

  return new Promise((resolve) => {
    let timer: number | null = null
    const onAbort = () => {
      if (timer != null) {
        window.clearTimeout(timer)
        timer = null
      }
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }

    timer = window.setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, 0)

    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
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


export {
  parseUrlState,
  sanitizeDownloadFileNameBase,
  parseContentDispositionFilename,
  extensionFromMimeType,
  normalizePointInlineImageUrl,
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
}
