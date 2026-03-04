import { describe, it, expect } from 'vitest'
import {
  getSortedPoints,
  getUnsortedPoints,
  rebuildPoints,
  reorderSortedInPoints,
  addPointToZoneInPoints,
  movePointToZoneInPoints,
  buildGoogleDirectionsUrl,
  buildGoogleDirectionsEmbedUrl,
  buildPointLookupCandidates,
  isGeoPair,
  buildGooglePointEmbedUrl,
  buildGoogleLegDirectionsUrl,
  parseBangumiId,
  parsePointKey,
  isPointRecord,
  formatGoogleStop,
  buildFallbackPreview,
  pickPointGradient,
  formatDate,
  sortedDragId,
  unsortedDragId,
  poolDragId,
  parseDragRecordId,
} from '@/app/(authed)/me/routebooks/[id]/utils'
import type { PointRecord, PointPreview } from '@/app/(authed)/me/routebooks/[id]/types'
import { SORTED_DND_PREFIX, UNSORTED_DND_PREFIX, POOL_DND_PREFIX } from '@/app/(authed)/me/routebooks/[id]/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePoint(overrides: Partial<PointRecord> & { pointId: string }): PointRecord {
  const {
    pointId,
    id,
    sortOrder,
    zone,
    ...rest
  } = overrides

  return {
    id: id ?? pointId,
    routeBookId: 'rb-1',
    pointId,
    sortOrder: sortOrder ?? 0,
    zone: zone ?? 'sorted',
    createdAt: '2025-01-01T00:00:00Z',
    ...rest,
  }
}

// ---------------------------------------------------------------------------
// getSortedPoints / getUnsortedPoints
// ---------------------------------------------------------------------------

describe('getSortedPoints', () => {
  it('returns only sorted points ordered by sortOrder', () => {
    const points = [
      makePoint({ pointId: 'a', zone: 'sorted', sortOrder: 2 }),
      makePoint({ pointId: 'b', zone: 'unsorted', sortOrder: 0 }),
      makePoint({ pointId: 'c', zone: 'sorted', sortOrder: 0 }),
    ]
    const result = getSortedPoints(points)
    expect(result).toHaveLength(2)
    expect(result[0].pointId).toBe('c')
    expect(result[1].pointId).toBe('a')
  })

  it('returns empty array when no sorted points', () => {
    const points = [makePoint({ pointId: 'a', zone: 'unsorted' })]
    expect(getSortedPoints(points)).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(getSortedPoints([])).toEqual([])
  })
})

describe('getUnsortedPoints', () => {
  it('returns only unsorted points ordered by sortOrder', () => {
    const points = [
      makePoint({ pointId: 'a', zone: 'unsorted', sortOrder: 3 }),
      makePoint({ pointId: 'b', zone: 'sorted', sortOrder: 0 }),
      makePoint({ pointId: 'c', zone: 'unsorted', sortOrder: 1 }),
    ]
    const result = getUnsortedPoints(points)
    expect(result).toHaveLength(2)
    expect(result[0].pointId).toBe('c')
    expect(result[1].pointId).toBe('a')
  })

  it('returns empty array when no unsorted points', () => {
    const points = [makePoint({ pointId: 'a', zone: 'sorted' })]
    expect(getUnsortedPoints(points)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// rebuildPoints
// ---------------------------------------------------------------------------

describe('rebuildPoints', () => {
  it('merges sorted and unsorted with re-indexed sortOrder', () => {
    const sorted = [
      makePoint({ pointId: 'a', zone: 'sorted', sortOrder: 99 }),
      makePoint({ pointId: 'b', zone: 'sorted', sortOrder: 50 }),
    ]
    const unsorted = [
      makePoint({ pointId: 'c', zone: 'unsorted', sortOrder: 77 }),
    ]
    const result = rebuildPoints(sorted, unsorted)
    expect(result).toHaveLength(3)
    // sorted re-indexed 0,1
    expect(result[0]).toMatchObject({ pointId: 'a', zone: 'sorted', sortOrder: 0 })
    expect(result[1]).toMatchObject({ pointId: 'b', zone: 'sorted', sortOrder: 1 })
    // unsorted re-indexed 0
    expect(result[2]).toMatchObject({ pointId: 'c', zone: 'unsorted', sortOrder: 0 })
  })

  it('handles empty sorted', () => {
    const unsorted = [makePoint({ pointId: 'x', zone: 'unsorted' })]
    const result = rebuildPoints([], unsorted)
    expect(result).toHaveLength(1)
    expect(result[0].zone).toBe('unsorted')
  })

  it('handles both empty', () => {
    expect(rebuildPoints([], [])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// reorderSortedInPoints
// ---------------------------------------------------------------------------

describe('reorderSortedInPoints', () => {
  const base = [
    makePoint({ id: 's1', pointId: 'a', zone: 'sorted', sortOrder: 0 }),
    makePoint({ id: 's2', pointId: 'b', zone: 'sorted', sortOrder: 1 }),
    makePoint({ id: 's3', pointId: 'c', zone: 'sorted', sortOrder: 2 }),
    makePoint({ id: 'u1', pointId: 'd', zone: 'unsorted', sortOrder: 0 }),
  ]

  it('reorders sorted points by new id order', () => {
    const result = reorderSortedInPoints(base, ['c', 'a', 'b'])
    const sorted = getSortedPoints(result)
    expect(sorted.map((p) => p.pointId)).toEqual(['c', 'a', 'b'])
    expect(sorted.map((p) => p.sortOrder)).toEqual([0, 1, 2])
  })

  it('moves last to first', () => {
    const result = reorderSortedInPoints(base, ['c', 'a', 'b'])
    const sorted = getSortedPoints(result)
    expect(sorted[0].pointId).toBe('c')
  })

  it('preserves unsorted points', () => {
    const result = reorderSortedInPoints(base, ['b', 'c', 'a'])
    const unsorted = getUnsortedPoints(result)
    expect(unsorted).toHaveLength(1)
    expect(unsorted[0].pointId).toBe('d')
  })

  it('handles partial id list (missing ids appended)', () => {
    // only 'b' in new order → 'a','c' should be appended after
    const result = reorderSortedInPoints(base, ['b'])
    const sorted = getSortedPoints(result)
    expect(sorted[0].pointId).toBe('b')
    // remaining sorted points appended in original order
    expect(sorted.map((p) => p.pointId)).toEqual(['b', 'a', 'c'])
  })

  it('handles empty sortedPointIds (keeps original order)', () => {
    const result = reorderSortedInPoints(base, [])
    const sorted = getSortedPoints(result)
    expect(sorted.map((p) => p.pointId)).toEqual(['a', 'b', 'c'])
  })
})

// ---------------------------------------------------------------------------
// addPointToZoneInPoints
// ---------------------------------------------------------------------------

describe('addPointToZoneInPoints', () => {
  const base = [
    makePoint({ id: 's1', pointId: 'a', zone: 'sorted', sortOrder: 0 }),
    makePoint({ id: 's2', pointId: 'b', zone: 'sorted', sortOrder: 1 }),
  ]

  it('adds to sorted zone at end by default', () => {
    const newPt = makePoint({ id: 'n1', pointId: 'x', zone: 'unsorted' })
    const result = addPointToZoneInPoints(base, newPt, 'sorted')
    const sorted = getSortedPoints(result)
    expect(sorted).toHaveLength(3)
    expect(sorted[2].pointId).toBe('x')
  })

  it('adds to sorted zone at specific index', () => {
    const newPt = makePoint({ id: 'n1', pointId: 'x', zone: 'unsorted' })
    const result = addPointToZoneInPoints(base, newPt, 'sorted', 0)
    const sorted = getSortedPoints(result)
    expect(sorted[0].pointId).toBe('x')
  })

  it('adds to unsorted zone', () => {
    const newPt = makePoint({ id: 'n1', pointId: 'x', zone: 'sorted' })
    const result = addPointToZoneInPoints(base, newPt, 'unsorted')
    const unsorted = getUnsortedPoints(result)
    expect(unsorted).toHaveLength(1)
    expect(unsorted[0].pointId).toBe('x')
  })

  it('adds to empty points array', () => {
    const newPt = makePoint({ id: 'n1', pointId: 'x' })
    const result = addPointToZoneInPoints([], newPt, 'sorted')
    expect(result).toHaveLength(1)
    expect(result[0].zone).toBe('sorted')
  })
})

// ---------------------------------------------------------------------------
// movePointToZoneInPoints
// ---------------------------------------------------------------------------

describe('movePointToZoneInPoints', () => {
  const base = [
    makePoint({ id: 's1', pointId: 'a', zone: 'sorted', sortOrder: 0 }),
    makePoint({ id: 's2', pointId: 'b', zone: 'sorted', sortOrder: 1 }),
    makePoint({ id: 'u1', pointId: 'c', zone: 'unsorted', sortOrder: 0 }),
  ]

  it('moves from sorted to unsorted', () => {
    const result = movePointToZoneInPoints(base, 'a', 'unsorted')
    expect(getSortedPoints(result).map((p) => p.pointId)).toEqual(['b'])
    expect(getUnsortedPoints(result).map((p) => p.pointId)).toEqual(['c', 'a'])
  })

  it('moves from unsorted to sorted (appends at end)', () => {
    const result = movePointToZoneInPoints(base, 'c', 'sorted')
    const sorted = getSortedPoints(result)
    expect(sorted.map((p) => p.pointId)).toEqual(['a', 'b', 'c'])
  })

  it('moves from unsorted to sorted at specific index', () => {
    const result = movePointToZoneInPoints(base, 'c', 'sorted', 0)
    const sorted = getSortedPoints(result)
    expect(sorted[0].pointId).toBe('c')
  })

  it('returns original points when pointId not found', () => {
    const result = movePointToZoneInPoints(base, 'nonexistent', 'sorted')
    expect(result).toBe(base)
  })
})

// ---------------------------------------------------------------------------
// buildGoogleDirectionsUrl
// ---------------------------------------------------------------------------

describe('buildGoogleDirectionsUrl', () => {
  it('returns null for 0 stops', () => {
    expect(buildGoogleDirectionsUrl([], 'transit')).toBeNull()
  })

  it('builds destination-only URL for 1 stop', () => {
    const url = buildGoogleDirectionsUrl(['Tokyo'], 'transit')!
    expect(url).toContain('destination=Tokyo')
    expect(url).toContain('travelmode=transit')
    expect(url).not.toContain('origin=')
    expect(url).not.toContain('waypoints')
  })

  it('builds origin+destination URL for 2 stops', () => {
    const url = buildGoogleDirectionsUrl(['A', 'B'], 'driving')!
    expect(url).toContain('origin=A')
    expect(url).toContain('destination=B')
    expect(url).toContain('travelmode=driving')
    expect(url).not.toContain('waypoints')
  })

  it('builds URL with waypoints for 3 stops', () => {
    const url = buildGoogleDirectionsUrl(['A', 'B', 'C'], 'transit')!
    expect(url).toContain('origin=A')
    expect(url).toContain('destination=C')
    expect(url).toContain('waypoints=B')
  })

  it('handles 25 stops (max Google limit)', () => {
    const stops = Array.from({ length: 25 }, (_, i) => `Stop${i}`)
    const url = buildGoogleDirectionsUrl(stops, 'driving')!
    expect(url).toContain('origin=Stop0')
    expect(url).toContain('destination=Stop24')
    // 23 waypoints
    const waypointsMatch = url.match(/waypoints=([^&]+)/)
    expect(waypointsMatch).toBeTruthy()
    const waypoints = decodeURIComponent(waypointsMatch![1]).split('|')
    expect(waypoints).toHaveLength(23)
  })
})

// ---------------------------------------------------------------------------
// buildGoogleDirectionsEmbedUrl
// ---------------------------------------------------------------------------

describe('buildGoogleDirectionsEmbedUrl', () => {
  it('returns null when apiKey is empty', () => {
    expect(buildGoogleDirectionsEmbedUrl(['A', 'B'], 'transit', '')).toBeNull()
  })

  it('returns null for fewer than 2 stops', () => {
    expect(buildGoogleDirectionsEmbedUrl([], 'transit', 'key123')).toBeNull()
    expect(buildGoogleDirectionsEmbedUrl(['A'], 'transit', 'key123')).toBeNull()
  })

  it('builds embed URL for 2 stops', () => {
    const url = buildGoogleDirectionsEmbedUrl(['A', 'B'], 'driving', 'mykey')!
    expect(url).toContain('google.com/maps/embed/v1/directions')
    expect(url).toContain('key=mykey')
    expect(url).toContain('origin=A')
    expect(url).toContain('destination=B')
    expect(url).toContain('mode=driving')
  })

  it('includes waypoints for 3+ stops', () => {
    const url = buildGoogleDirectionsEmbedUrl(['A', 'B', 'C'], 'transit', 'k')!
    expect(url).toContain('waypoints=B')
  })

  it('handles 25 stops', () => {
    const stops = Array.from({ length: 25 }, (_, i) => `S${i}`)
    const url = buildGoogleDirectionsEmbedUrl(stops, 'transit', 'k')!
    expect(url).toContain('origin=S0')
    expect(url).toContain('destination=S24')
  })
})

// ---------------------------------------------------------------------------
// buildPointLookupCandidates
// ---------------------------------------------------------------------------

describe('buildPointLookupCandidates', () => {
  it('returns empty for empty string', () => {
    expect(buildPointLookupCandidates('')).toEqual([])
  })

  it('returns empty for whitespace-only', () => {
    expect(buildPointLookupCandidates('   ')).toEqual([])
  })

  it('returns candidates for simple id', () => {
    const result = buildPointLookupCandidates('abc')
    expect(result).toContain('abc')
  })

  it('returns candidates for bangumi-style id (123:pointKey)', () => {
    const result = buildPointLookupCandidates('456:mypoint')
    expect(result).toContain('456:mypoint')
    expect(result).toContain('mypoint')
  })

  it('includes lowercase variants', () => {
    const result = buildPointLookupCandidates('ABC:DEF')
    expect(result).toContain('abc:def')
    expect(result).toContain('def')
  })

  it('deduplicates candidates', () => {
    const result = buildPointLookupCandidates('abc')
    const unique = new Set(result)
    expect(unique.size).toBe(result.length)
  })
})

// ---------------------------------------------------------------------------
// isGeoPair
// ---------------------------------------------------------------------------

describe('isGeoPair', () => {
  it('accepts valid lat/lng pair', () => {
    expect(isGeoPair([35.6, 139.7])).toBe(true)
  })

  it('rejects non-array', () => {
    expect(isGeoPair('35,139')).toBe(false)
    expect(isGeoPair(null)).toBe(false)
    expect(isGeoPair(undefined)).toBe(false)
  })

  it('rejects array with fewer than 2 elements', () => {
    expect(isGeoPair([35])).toBe(false)
    expect(isGeoPair([])).toBe(false)
  })

  it('rejects out-of-range lat', () => {
    expect(isGeoPair([91, 0])).toBe(false)
    expect(isGeoPair([-91, 0])).toBe(false)
  })

  it('rejects out-of-range lng', () => {
    expect(isGeoPair([0, 181])).toBe(false)
    expect(isGeoPair([0, -181])).toBe(false)
  })

  it('rejects NaN values', () => {
    expect(isGeoPair([NaN, 0])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isPointRecord
// ---------------------------------------------------------------------------

describe('isPointRecord', () => {
  it('returns true for valid PointRecord', () => {
    expect(isPointRecord(makePoint({ pointId: 'a' }))).toBe(true)
  })

  it('returns false for null/undefined', () => {
    expect(isPointRecord(null)).toBe(false)
    expect(isPointRecord(undefined)).toBe(false)
  })

  it('returns false when missing required fields', () => {
    expect(isPointRecord({ id: '1' })).toBe(false)
  })

  it('returns false for invalid zone', () => {
    expect(isPointRecord({ ...makePoint({ pointId: 'a' }), zone: 'other' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseBangumiId / parsePointKey
// ---------------------------------------------------------------------------

describe('parseBangumiId', () => {
  it('parses numeric prefix', () => {
    expect(parseBangumiId('123:abc')).toBe(123)
  })

  it('returns null for non-numeric', () => {
    expect(parseBangumiId('abc:def')).toBeNull()
  })

  it('returns null for zero', () => {
    expect(parseBangumiId('0:abc')).toBeNull()
  })

  it('returns null for negative', () => {
    expect(parseBangumiId('-5:abc')).toBeNull()
  })
})

describe('parsePointKey', () => {
  it('returns part after colon', () => {
    expect(parsePointKey('123:abc')).toBe('abc')
  })

  it('returns full string when no colon', () => {
    expect(parsePointKey('abc')).toBe('abc')
  })
})

// ---------------------------------------------------------------------------
// formatGoogleStop
// ---------------------------------------------------------------------------

describe('formatGoogleStop', () => {
  it('uses geo coordinates when available', () => {
    const point = makePoint({ pointId: 'p1' })
    const preview: PointPreview = { title: 'Place', subtitle: '', image: null, geo: [35.6, 139.7] }
    expect(formatGoogleStop(point, preview)).toBe('35.6,139.7')
  })

  it('falls back to title when no geo', () => {
    const point = makePoint({ pointId: 'p1' })
    const preview: PointPreview = { title: 'My Place', subtitle: '', image: null, geo: null }
    expect(formatGoogleStop(point, preview)).toBe('My Place')
  })

  it('falls back to pointId when no geo and no title', () => {
    const point = makePoint({ pointId: 'p1' })
    const preview: PointPreview = { title: '', subtitle: '', image: null, geo: null }
    expect(formatGoogleStop(point, preview)).toBe('p1')
  })
})

// ---------------------------------------------------------------------------
// buildGooglePointEmbedUrl
// ---------------------------------------------------------------------------

describe('buildGooglePointEmbedUrl', () => {
  it('returns embed URL for valid geo', () => {
    const preview: PointPreview = { title: 'X', subtitle: '', image: null, geo: [35.6, 139.7] }
    const url = buildGooglePointEmbedUrl(preview)!
    expect(url).toContain('google.com/maps')
    expect(url).toContain('35.6')
    expect(url).toContain('139.7')
  })

  it('returns null for null preview', () => {
    expect(buildGooglePointEmbedUrl(null)).toBeNull()
  })

  it('returns null when geo is null', () => {
    const preview: PointPreview = { title: 'X', subtitle: '', image: null, geo: null }
    expect(buildGooglePointEmbedUrl(preview)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// DnD id helpers
// ---------------------------------------------------------------------------

describe('drag id helpers', () => {
  it('sortedDragId prefixes correctly', () => {
    expect(sortedDragId('r1')).toBe(`${SORTED_DND_PREFIX}r1`)
  })

  it('unsortedDragId prefixes correctly', () => {
    expect(unsortedDragId('r1')).toBe(`${UNSORTED_DND_PREFIX}r1`)
  })

  it('poolDragId prefixes correctly', () => {
    expect(poolDragId('p1')).toBe(`${POOL_DND_PREFIX}p1`)
  })

  it('parseDragRecordId extracts id from prefixed string', () => {
    expect(parseDragRecordId(`${SORTED_DND_PREFIX}abc`, SORTED_DND_PREFIX)).toBe('abc')
  })

  it('parseDragRecordId returns null for wrong prefix', () => {
    expect(parseDragRecordId(`${UNSORTED_DND_PREFIX}abc`, SORTED_DND_PREFIX)).toBeNull()
  })

  it('parseDragRecordId returns null for empty value after prefix', () => {
    expect(parseDragRecordId(SORTED_DND_PREFIX, SORTED_DND_PREFIX)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('formats valid date string', () => {
    const result = formatDate('2025-06-15T00:00:00Z')
    // locale-dependent but should contain year
    expect(result).toContain('2025')
  })

  it('returns fallback for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('最近更新')
  })
})

// ---------------------------------------------------------------------------
// buildFallbackPreview / pickPointGradient
// ---------------------------------------------------------------------------

describe('buildFallbackPreview', () => {
  it('builds preview with parsed key and bangumi id', () => {
    const preview = buildFallbackPreview('123:mypoint')
    expect(preview.title).toContain('mypoint')
    expect(preview.subtitle).toContain('123')
    expect(preview.image).toBeNull()
    expect(preview.geo).toBeNull()
  })
})

describe('pickPointGradient', () => {
  it('returns a gradient string from the palette', () => {
    const gradient = pickPointGradient('test-seed')
    expect(gradient).toContain('from-')
    expect(gradient).toContain('to-')
  })

  it('returns deterministic result for same seed', () => {
    expect(pickPointGradient('abc')).toBe(pickPointGradient('abc'))
  })
})

// ---------------------------------------------------------------------------
// buildGoogleLegDirectionsUrl
// ---------------------------------------------------------------------------

describe('buildGoogleLegDirectionsUrl', () => {
  it('builds URL with origin and destination', () => {
    const url = buildGoogleLegDirectionsUrl('A', 'B', 'transit')
    expect(url).toContain('origin=A')
    expect(url).toContain('destination=B')
    expect(url).toContain('travelmode=transit')
  })
})
