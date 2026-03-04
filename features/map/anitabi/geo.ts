import maplibregl from 'maplibre-gl'
import {
  CLUSTER_JOIN_DISTANCE_MAX_METERS,
  CLUSTER_JOIN_DISTANCE_MIN_METERS,
  CLUSTER_JOIN_DISTANCE_SCALE,
  POINT_LAYER_ID,
  POINT_SELECTED_HALO_LAYER_ID,
  POINT_SELECTED_LAYER_ID,
  POINT_SOURCE_ID,
  RANGE_FILL_LAYER_ID,
  RANGE_LINE_LAYER_ID,
  RANGE_SOURCE_ID,
} from './shared'
import type { PointCoord } from './shared'

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


export {
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
}
