import type { PointRecord, PointPreview, NavMode, RouteBookZone } from './types'
import { NAV_MODE_PARAM, POINT_FALLBACK_GRADIENTS, SORTED_DND_PREFIX, UNSORTED_DND_PREFIX, POOL_DND_PREFIX } from './types'

export function isPointRecord(value: unknown): value is PointRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.routeBookId === 'string' &&
    typeof row.pointId === 'string' &&
    typeof row.sortOrder === 'number' &&
    (row.zone === 'sorted' || row.zone === 'unsorted') &&
    typeof row.createdAt === 'string'
  )
}

export function getSortedPoints(points: PointRecord[]): PointRecord[] {
  return points
    .filter((point) => point.zone === 'sorted')
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export function getUnsortedPoints(points: PointRecord[]): PointRecord[] {
  return points
    .filter((point) => point.zone === 'unsorted')
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export function rebuildPoints(sorted: PointRecord[], unsorted: PointRecord[]): PointRecord[] {
  const normalizedSorted = sorted.map((point, index) => ({ ...point, zone: 'sorted' as const, sortOrder: index }))
  const normalizedUnsorted = unsorted.map((point, index) => ({ ...point, zone: 'unsorted' as const, sortOrder: index }))
  return [...normalizedSorted, ...normalizedUnsorted]
}

export function reorderSortedInPoints(points: PointRecord[], sortedPointIds: string[]): PointRecord[] {
  const sorted = getSortedPoints(points)
  const unsorted = getUnsortedPoints(points)
  const byPointId = new Map(sorted.map((point) => [point.pointId, point]))

  const reordered: PointRecord[] = []
  for (const pointId of sortedPointIds) {
    const matched = byPointId.get(pointId)
    if (!matched) continue
    reordered.push({ ...matched, zone: 'sorted' })
    byPointId.delete(pointId)
  }

  for (const point of sorted) {
    if (byPointId.has(point.pointId)) {
      reordered.push({ ...point, zone: 'sorted' })
    }
  }

  return rebuildPoints(reordered, unsorted)
}

export function movePointToZoneInPoints(
  points: PointRecord[],
  pointId: string,
  targetZone: RouteBookZone,
  targetSortedIndex?: number
): PointRecord[] {
  const sorted = getSortedPoints(points)
  const unsorted = getUnsortedPoints(points)
  const source = sorted.find((point) => point.pointId === pointId) || unsorted.find((point) => point.pointId === pointId)
  if (!source) return points

  const nextSorted = sorted.filter((point) => point.id !== source.id)
  const nextUnsorted = unsorted.filter((point) => point.id !== source.id)

  if (targetZone === 'sorted') {
    const insertAt = Math.max(0, Math.min(typeof targetSortedIndex === 'number' ? targetSortedIndex : nextSorted.length, nextSorted.length))
    nextSorted.splice(insertAt, 0, { ...source, zone: 'sorted' })
    return rebuildPoints(nextSorted, nextUnsorted)
  }

  nextUnsorted.push({ ...source, zone: 'unsorted' })
  return rebuildPoints(nextSorted, nextUnsorted)
}

export function addPointToZoneInPoints(
  points: PointRecord[],
  created: PointRecord,
  targetZone: RouteBookZone,
  targetSortedIndex?: number
): PointRecord[] {
  const sorted = getSortedPoints(points)
  const unsorted = getUnsortedPoints(points)
  const sanitized = { ...created, zone: targetZone }

  if (targetZone === 'sorted') {
    const insertAt = Math.max(0, Math.min(typeof targetSortedIndex === 'number' ? targetSortedIndex : sorted.length, sorted.length))
    sorted.splice(insertAt, 0, sanitized)
    return rebuildPoints(sorted, unsorted)
  }

  unsorted.push(sanitized)
  return rebuildPoints(sorted, unsorted)
}

export function formatGoogleStop(point: PointRecord, preview: PointPreview): string {
  if (isGeoPair(preview.geo)) return `${preview.geo[0]},${preview.geo[1]}`
  return preview.title || point.pointId
}

export function buildGooglePointEmbedUrl(preview: PointPreview | null): string | null {
  if (!preview || !isGeoPair(preview.geo)) return null
  const [lat, lng] = preview.geo
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=16&output=embed`
}

export function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '最近更新'
  return parsed.toLocaleDateString('zh-CN')
}

export function parseBangumiId(pointId: string): number | null {
  const [raw] = pointId.split(':')
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function parsePointKey(pointId: string): string {
  const sep = pointId.indexOf(':')
  if (sep < 0) return pointId
  return pointId.slice(sep + 1)
}

export function buildPointLookupCandidates(pointId: string): string[] {
  const raw = String(pointId || '').trim()
  if (!raw) return []

  const parsed = parsePointKey(raw)
  const bangumiId = parseBangumiId(raw)
  const out = new Set<string>()
  const push = (value: string | null | undefined) => {
    const normalized = String(value || '').trim()
    if (!normalized) return
    out.add(normalized)
    out.add(normalized.toLowerCase())
  }

  push(raw)
  push(parsed)
  if (bangumiId && parsed) {
    push(`${bangumiId}:${parsed}`)
  }

  return Array.from(out)
}

export function pickPointGradient(seed: string): string {
  let value = 0
  for (const char of seed) value = (value * 29 + char.charCodeAt(0)) % 997
  return POINT_FALLBACK_GRADIENTS[value % POINT_FALLBACK_GRADIENTS.length]
}

export function buildFallbackPreview(pointId: string): PointPreview {
  return {
    title: `点位 ${parsePointKey(pointId)}`,
    subtitle: `番剧 #${parseBangumiId(pointId) || '未知'}`,
    image: null,
    geo: null,
  }
}

export function buildGoogleDirectionsUrl(stops: string[], mode?: NavMode): string | null {
  if (!stops.length) return null

  if (stops.length === 1) {
    const params = new URLSearchParams({
      api: '1',
      destination: stops[0],
    })
    if (mode) {
      params.set('travelmode', NAV_MODE_PARAM[mode])
    }
    return `https://www.google.com/maps/dir/?${params.toString()}`
  }

  const origin = stops[0]
  const destination = stops[stops.length - 1]
  if (!origin || !destination) return null

  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
  })
  if (mode) {
    params.set('travelmode', NAV_MODE_PARAM[mode])
  }
  const waypoints = stops.slice(1, -1)
  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.join('|'))
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export function buildGoogleDirectionsEmbedUrl(stops: string[], mode: NavMode, apiKey: string): string | null {
  const key = String(apiKey || '').trim()
  if (!key || stops.length < 2) return null

  const origin = stops[0]
  const destination = stops[stops.length - 1]
  if (!origin || !destination) return null

  const params = new URLSearchParams({
    key,
    origin,
    destination,
    mode: NAV_MODE_PARAM[mode],
  })
  const waypoints = stops.slice(1, -1)
  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.join('|'))
  }
  return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`
}

export function buildGoogleLegDirectionsUrl(fromStop: string, toStop: string, mode: NavMode): string {
  const params = new URLSearchParams({
    api: '1',
    origin: fromStop,
    destination: toStop,
    travelmode: NAV_MODE_PARAM[mode],
  })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export function isGeoPair(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length < 2) return false
  const lat = Number(value[0])
  const lng = Number(value[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false
  return true
}

export function sortedDragId(recordId: string): string {
  return `${SORTED_DND_PREFIX}${recordId}`
}

export function unsortedDragId(recordId: string): string {
  return `${UNSORTED_DND_PREFIX}${recordId}`
}

export function poolDragId(poolItemId: string): string {
  return `${POOL_DND_PREFIX}${poolItemId}`
}

export function parseDragRecordId(rawId: string, prefix: string): string | null {
  if (!rawId.startsWith(prefix)) return null
  const value = rawId.slice(prefix.length)
  return value || null
}
