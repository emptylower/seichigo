import { describe, it, expect } from 'vitest'

/**
 * Unit tests for the pure coordinate logic used by useRouteGeometry hook.
 *
 * The hook (app/(authed)/me/routebooks/[id]/hooks/useRouteGeometry.ts) contains
 * two internal pure functions — computeSignature and resolveGeoPoints — that
 * determine cache keys and geolocated waypoints. We replicate their logic here
 * to verify correctness without needing a React/DOM environment.
 */

// ---------------------------------------------------------------------------
// Types (mirror from routebook types)
// ---------------------------------------------------------------------------

type PointRecord = {
  id: string
  routeBookId: string
  pointId: string
  sortOrder: number
  zone: 'sorted' | 'unsorted'
  createdAt: string
}

type PointPreview = {
  title: string
  subtitle: string
  image: string | null
  geo: [number, number] | null
}

// ---------------------------------------------------------------------------
// Pure functions under test (mirrored from useRouteGeometry.ts)
// ---------------------------------------------------------------------------

/** Build a cache key from geolocated points (lng,lat pairs joined by |). */
function computeSignature(
  sortedPoints: PointRecord[],
  getGeo: (pointId: string) => [number, number] | null,
): string {
  return sortedPoints
    .map((p) => getGeo(p.pointId))
    .filter((g): g is [number, number] => g != null)
    .map(([lng, lat]) => `${lng},${lat}`)
    .join('|')
}

/** Extract geolocated coordinate pairs from sorted points. */
function resolveGeoPoints(
  sortedPoints: PointRecord[],
  getGeo: (pointId: string) => [number, number] | null,
): [number, number][] {
  const result: [number, number][] = []
  for (const p of sortedPoints) {
    const geo = getGeo(p.pointId)
    if (geo) result.push(geo)
  }
  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePoint(pointId: string, sortOrder: number): PointRecord {
  return {
    id: pointId,
    routeBookId: 'rb-1',
    pointId,
    sortOrder,
    zone: 'sorted',
    createdAt: '2025-01-01T00:00:00Z',
  }
}

function makeGeoLookup(
  map: Record<string, [number, number] | null>,
): (pointId: string) => [number, number] | null {
  return (pointId: string) => map[pointId] ?? null
}

// ---------------------------------------------------------------------------
// Tests: computeSignature
// ---------------------------------------------------------------------------

describe('computeSignature', () => {
  it('builds pipe-separated lng,lat string for geolocated points', () => {
    const points = [makePoint('a', 0), makePoint('b', 1)]
    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: [135.5, 34.7],
    })

    expect(computeSignature(points, getGeo)).toBe('139.7,35.6|135.5,34.7')
  })

  it('skips points without geo data', () => {
    const points = [makePoint('a', 0), makePoint('b', 1), makePoint('c', 2)]
    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: null,
      c: [135.5, 34.7],
    })

    expect(computeSignature(points, getGeo)).toBe('139.7,35.6|135.5,34.7')
  })

  it('returns empty string when no points have geo data', () => {
    const points = [makePoint('a', 0), makePoint('b', 1)]
    const getGeo = makeGeoLookup({ a: null, b: null })

    expect(computeSignature(points, getGeo)).toBe('')
  })

  it('returns empty string for empty point list', () => {
    const getGeo = makeGeoLookup({})
    expect(computeSignature([], getGeo)).toBe('')
  })

  it('produces different signatures for different orderings', () => {
    const ab = [makePoint('a', 0), makePoint('b', 1)]
    const ba = [makePoint('b', 0), makePoint('a', 1)]
    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: [135.5, 34.7],
    })

    const sigAB = computeSignature(ab, getGeo)
    const sigBA = computeSignature(ba, getGeo)
    expect(sigAB).not.toBe(sigBA)
  })

  it('produces identical signatures for same coordinates in same order', () => {
    const points1 = [makePoint('a', 0), makePoint('b', 1)]
    const points2 = [makePoint('a', 0), makePoint('b', 1)]
    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: [135.5, 34.7],
    })

    expect(computeSignature(points1, getGeo)).toBe(
      computeSignature(points2, getGeo),
    )
  })

  it('handles single geolocated point', () => {
    const points = [makePoint('a', 0)]
    const getGeo = makeGeoLookup({ a: [139.7, 35.6] })

    expect(computeSignature(points, getGeo)).toBe('139.7,35.6')
  })

  it('preserves decimal precision in signature', () => {
    const points = [makePoint('a', 0)]
    const getGeo = makeGeoLookup({ a: [139.691706, 35.689487] })

    expect(computeSignature(points, getGeo)).toBe('139.691706,35.689487')
  })
})

// ---------------------------------------------------------------------------
// Tests: resolveGeoPoints
// ---------------------------------------------------------------------------

describe('resolveGeoPoints', () => {
  it('extracts geo coordinates from geolocated points', () => {
    const points = [makePoint('a', 0), makePoint('b', 1)]
    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: [135.5, 34.7],
    })

    expect(resolveGeoPoints(points, getGeo)).toEqual([
      [139.7, 35.6],
      [135.5, 34.7],
    ])
  })

  it('filters out points without geo data', () => {
    const points = [makePoint('a', 0), makePoint('b', 1), makePoint('c', 2)]
    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: null,
      c: [135.5, 34.7],
    })

    expect(resolveGeoPoints(points, getGeo)).toEqual([
      [139.7, 35.6],
      [135.5, 34.7],
    ])
  })

  it('returns empty array when no points have geo', () => {
    const points = [makePoint('a', 0)]
    const getGeo = makeGeoLookup({ a: null })

    expect(resolveGeoPoints(points, getGeo)).toEqual([])
  })

  it('returns empty array for empty input', () => {
    const getGeo = makeGeoLookup({})
    expect(resolveGeoPoints([], getGeo)).toEqual([])
  })

  it('returns < 2 points when only one is geolocated (triggers null geometry in hook)', () => {
    const points = [makePoint('a', 0), makePoint('b', 1), makePoint('c', 2)]
    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: null,
      c: null,
    })

    const result = resolveGeoPoints(points, getGeo)
    expect(result).toHaveLength(1)
    // Hook would set geometry to null for < 2 geolocated points
  })
})

// ---------------------------------------------------------------------------
// Tests: cache key behavior (signature-based caching logic)
// ---------------------------------------------------------------------------

describe('signature-based cache behavior', () => {
  it('same points with same geo produce cache hit (identical signature)', () => {
    const cache = new Map<string, { type: string }>()
    const cachedGeometry = { type: 'LineString' }

    const points = [makePoint('a', 0), makePoint('b', 1)]
    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: [135.5, 34.7],
    })

    // First fetch: compute signature and store
    const sig1 = computeSignature(points, getGeo)
    cache.set(sig1, cachedGeometry)

    // Second "render": same points, same geo → same signature → cache hit
    const sig2 = computeSignature(points, getGeo)
    expect(cache.has(sig2)).toBe(true)
    expect(cache.get(sig2)).toBe(cachedGeometry)
  })

  it('reordered points produce cache miss (different signature)', () => {
    const cache = new Map<string, { type: string }>()

    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: [135.5, 34.7],
    })

    const original = [makePoint('a', 0), makePoint('b', 1)]
    const sig1 = computeSignature(original, getGeo)
    cache.set(sig1, { type: 'LineString' })

    // Reorder: b before a
    const reordered = [makePoint('b', 0), makePoint('a', 1)]
    const sig2 = computeSignature(reordered, getGeo)
    expect(cache.has(sig2)).toBe(false)
  })

  it('adding a new geolocated point produces cache miss', () => {
    const cache = new Map<string, { type: string }>()

    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: [135.5, 34.7],
      c: [136.9, 35.2],
    })

    const twoPoints = [makePoint('a', 0), makePoint('b', 1)]
    const sig1 = computeSignature(twoPoints, getGeo)
    cache.set(sig1, { type: 'LineString' })

    const threePoints = [
      makePoint('a', 0),
      makePoint('b', 1),
      makePoint('c', 2),
    ]
    const sig2 = computeSignature(threePoints, getGeo)
    expect(cache.has(sig2)).toBe(false)
  })

  it('removing a non-geo point does not change signature (cache hit)', () => {
    const cache = new Map<string, { type: string }>()

    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: null,
      c: [135.5, 34.7],
    })

    const withNonGeo = [
      makePoint('a', 0),
      makePoint('b', 1),
      makePoint('c', 2),
    ]
    const sig1 = computeSignature(withNonGeo, getGeo)
    cache.set(sig1, { type: 'LineString' })

    // Remove the non-geolocated point 'b'
    const withoutNonGeo = [makePoint('a', 0), makePoint('c', 2)]
    const sig2 = computeSignature(withoutNonGeo, getGeo)
    expect(cache.has(sig2)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: geometry resolution threshold
// ---------------------------------------------------------------------------

describe('geometry resolution threshold (< 2 geolocated points)', () => {
  it('0 geolocated points → no route geometry', () => {
    const points = [makePoint('a', 0), makePoint('b', 1)]
    const getGeo = makeGeoLookup({ a: null, b: null })

    const geoPoints = resolveGeoPoints(points, getGeo)
    expect(geoPoints.length).toBeLessThan(2)
  })

  it('1 geolocated point → no route geometry', () => {
    const points = [makePoint('a', 0), makePoint('b', 1)]
    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: null,
    })

    const geoPoints = resolveGeoPoints(points, getGeo)
    expect(geoPoints.length).toBeLessThan(2)
  })

  it('2 geolocated points → sufficient for route geometry', () => {
    const points = [makePoint('a', 0), makePoint('b', 1)]
    const getGeo = makeGeoLookup({
      a: [139.7, 35.6],
      b: [135.5, 34.7],
    })

    const geoPoints = resolveGeoPoints(points, getGeo)
    expect(geoPoints.length).toBeGreaterThanOrEqual(2)
  })

  it('many points but only 1 geolocated → no route geometry', () => {
    const points = [
      makePoint('a', 0),
      makePoint('b', 1),
      makePoint('c', 2),
      makePoint('d', 3),
      makePoint('e', 4),
    ]
    const getGeo = makeGeoLookup({
      a: null,
      b: null,
      c: [135.5, 34.7],
      d: null,
      e: null,
    })

    const geoPoints = resolveGeoPoints(points, getGeo)
    expect(geoPoints.length).toBeLessThan(2)
  })
})
