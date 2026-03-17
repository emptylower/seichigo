'use client'

import { useEffect, useRef, useState } from 'react'
import type { PointPreview, PointRecord } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GeoJSONLineString = {
  type: 'LineString'
  coordinates: [number, number][]
}

type RouteBookGeo = [number, number]

export type UseRouteGeometryResult = {
  geometry: GeoJSONLineString | null
  loading: boolean
  error: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a cache key from geolocated points (lng,lat pairs joined by |). */
function computeSignature(
  sortedPoints: PointRecord[],
  getGeo: (pointId: string) => RouteBookGeo | null,
): string {
  return sortedPoints
    .map((p) => getGeo(p.pointId))
    .filter((g): g is RouteBookGeo => g != null)
    .map(([lat, lng]) => `${lng},${lat}`)
    .join('|')
}

/** Extract geolocated coordinate pairs from sorted points. */
function resolveGeoPoints(
  sortedPoints: PointRecord[],
  getGeo: (pointId: string) => RouteBookGeo | null,
): [number, number][] {
  const result: [number, number][] = []
  for (const p of sortedPoints) {
    const geo = getGeo(p.pointId)
    if (geo) result.push([geo[1], geo[0]])
  }
  return result
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 800

/**
 * Fetches route geometry from the server proxy when sorted points change.
 *
 * - Debounces 800 ms to avoid spamming during drag-and-drop reordering.
 * - Caches results keyed by coordinate signature.
 * - Returns null geometry for < 2 geolocated points.
 */
export function useRouteGeometry(
  routeBookId: string,
  sortedPoints: PointRecord[],
  getPointPreview: (pointId: string) => PointPreview,
): UseRouteGeometryResult {
  const [geometry, setGeometry] = useState<GeoJSONLineString | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cacheRef = useRef<Map<string, GeoJSONLineString>>(new Map())

  // Stable getter: extract geo from PointPreview
  const getGeo = (pointId: string): RouteBookGeo | null => {
    return getPointPreview(pointId).geo
  }

  useEffect(() => {
    if (!routeBookId) {
      setGeometry(null)
      setLoading(false)
      return
    }

    const sig = computeSignature(sortedPoints, getGeo)
    const geoPoints = resolveGeoPoints(sortedPoints, getGeo)

    // < 2 geolocated points: clear geometry
    if (geoPoints.length < 2) {
      setGeometry(null)
      setLoading(false)
      setError(null)
      return
    }

    // Cache hit: use cached result immediately
    const cached = cacheRef.current.get(sig)
    if (cached) {
      setGeometry(cached)
      setLoading(false)
      setError(null)
      return
    }

    // Debounce: wait before fetching
    setLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const pointsParam = geoPoints.map(([lng, lat]) => `${lng},${lat}`).join('|')
        const res = await fetch(
          `/api/me/routebooks/${routeBookId}/route-geometry?points=${encodeURIComponent(pointsParam)}&mode=walking`,
        )
        const data = await res.json()
        if (data.ok && data.geometry) {
          cacheRef.current.set(sig, data.geometry as GeoJSONLineString)
          setGeometry(data.geometry as GeoJSONLineString)
          setError(null)
        } else {
          setError((data.error as string) || '路线获取失败')
          setGeometry(null)
        }
      } catch {
        setError('网络错误')
        setGeometry(null)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedPoints, routeBookId, getPointPreview])

  return { geometry, loading, error }
}
