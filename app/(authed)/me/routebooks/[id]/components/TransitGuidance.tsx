'use client'

import { useState, useCallback, useMemo } from 'react'
import { Train, Bus, Footprints, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TransitGuidanceProps {
  routeBookId: string
  sortedStops: Array<{ lat: number; lng: number; title: string }>
  travelMode: 'transit' | 'driving'
  visible: boolean
}

interface TransitDetail {
  lineName: string
  departureStop: string
  arrivalStop: string
  numStops: number
}

interface DirectionStep {
  travelMode: 'TRANSIT' | 'WALKING' | 'DRIVING'
  instruction: string
  duration: string
  durationSeconds: number
  distance: string
  distanceMeters: number
  transitDetails: TransitDetail | null
}

interface DirectionLeg {
  steps: DirectionStep[]
  distance: string
  duration: string
  startAddress: string
  endAddress: string
}

interface DirectionsResponse {
  ok: true
  legs: DirectionLeg[]
  mode: 'transit' | 'driving' | 'walking'
  requestedMode: 'transit' | 'driving'
  fallbackApplied: boolean
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function stopsHash(stops: Array<{ lat: number; lng: number }>): string {
  return JSON.stringify(stops.map(s => s.lat + ',' + s.lng))
}

function stepIcon(step: DirectionStep) {
  if (step.travelMode === 'WALKING') {
    return <Footprints className="h-4 w-4 text-gray-500 shrink-0" />
  }

  if (step.travelMode === 'TRANSIT') {
    const line = step.transitDetails?.lineName || ''
    if (/(bus|公交|巴士)/i.test(line)) {
      return <Bus className="h-4 w-4 text-blue-600 shrink-0" />
    }
    return <Train className="h-4 w-4 text-brand-500 shrink-0" />
  }

  return <Bus className="h-4 w-4 text-slate-500 shrink-0" />
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TransitGuidance({
  routeBookId,
  sortedStops,
  travelMode,
  visible,
}: TransitGuidanceProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [directions, setDirections] = useState<DirectionsResponse | null>(null)
  const [cachedStops, setCachedStops] = useState<string>('')

  const currentHash = useMemo(() => stopsHash(sortedStops), [sortedStops])
  const isStale = directions !== null && cachedStops !== currentHash

  const fetchDirections = useCallback(async () => {
    if (sortedStops.length < 2) return

    setIsLoading(true)
    setError(null)

    try {
      const origin = `${sortedStops[0].lat},${sortedStops[0].lng}`
      const destination = `${sortedStops[sortedStops.length - 1].lat},${sortedStops[sortedStops.length - 1].lng}`

      const params = new URLSearchParams({
        origin,
        destination,
        mode: travelMode,
      })

      if (sortedStops.length > 2) {
        const waypoints = sortedStops
          .slice(1, -1)
          .map(s => `${s.lat},${s.lng}`)
          .join('|')
        params.set('waypoints', waypoints)
      }

      const res = await fetch(
        `/api/me/routebooks/${routeBookId}/directions?${params.toString()}`
      )

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(
          body?.error || `请求失败 (${res.status})`
        )
      }

      const data: DirectionsResponse = await res.json()
      setDirections(data)
      setCachedStops(stopsHash(sortedStops))
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载乘车指引，请稍后重试')
    } finally {
      setIsLoading(false)
    }
  }, [routeBookId, sortedStops, travelMode])

  /* ---- early returns ---- */
  if (!visible) return null
  if (sortedStops.length < 2) return null

  /* ---- initial state: show trigger button ---- */
  if (!directions && !isLoading && !error) {
    return (
      <button
        type="button"
        onClick={fetchDirections}
        className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-brand-300 hover:text-brand-600"
      >
        查看乘车指引
      </button>
    )
  }

  /* ---- loading ---- */
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>加载中...</span>
      </div>
    )
  }

  /* ---- error ---- */
  if (error) {
    const fallbackTravelMode = travelMode === 'transit' ? 'walking' : travelMode

    // Build a fallback Google Maps URL so users can still navigate
    const fallbackUrl = sortedStops.length >= 2
      ? (() => {
          const origin = `${sortedStops[0].lat},${sortedStops[0].lng}`
          const dest = `${sortedStops[sortedStops.length - 1].lat},${sortedStops[sortedStops.length - 1].lng}`
          const wps = sortedStops.length > 2
            ? sortedStops.slice(1, -1).map(s => `${s.lat},${s.lng}`).join('|')
            : ''
          const p = new URLSearchParams({ api: '1', origin, destination: dest, travelmode: fallbackTravelMode })
          if (wps) p.set('waypoints', wps)
          return `https://www.google.com/maps/dir/?${p.toString()}`
        })()
      : null

    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
        <div className="flex items-center gap-2 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={fetchDirections}
            className="flex items-center gap-1.5 text-sm font-medium text-amber-700 transition hover:text-amber-900"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
          {fallbackUrl && (
            <a
              href={fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm font-medium text-brand-600 transition hover:text-brand-800"
            >
              在 Google Maps 中查看路线 ↗
            </a>
          )}
        </div>
      </div>
    )
  }

  /* ---- success ---- */
  const legs = directions?.legs ?? []

  return (
    <div className="space-y-3">
      {/* stale banner */}
      {isStale && (
        <button
          type="button"
          onClick={fetchDirections}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          路线已变更，点击刷新
        </button>
      )}

      {directions?.fallbackApplied && directions.mode === 'walking' && travelMode === 'transit' ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-700">
          当前无可用公共交通，已自动切换为步行路线。
        </div>
      ) : null}

      {/* legs */}
      {legs.map((leg, legIdx) => (
        <div
          key={legIdx}
          className="rounded-lg border border-gray-200 bg-white"
        >
          {/* leg header */}
          {legs.length > 1 && (
            <div className="border-b border-gray-100 px-4 py-2 text-xs font-medium text-gray-500">
              第 {legIdx + 1} 段 · {leg.distance} · {leg.duration}
            </div>
          )}

          {/* steps */}
          <div className="divide-y divide-gray-50">
            {leg.steps.map((step, stepIdx) => (
              <div
                key={stepIdx}
                className="flex items-start gap-3 px-4 py-3"
              >
                <div className="mt-0.5">{stepIcon(step)}</div>

                <div className="min-w-0 flex-1 text-sm">
                  {step.travelMode === 'WALKING' ? (
                    <p className="text-gray-600">
                      步行 {step.distance}，约 {step.duration}
                    </p>
                  ) : step.transitDetails ? (
                    <div className="space-y-1">
                      <p className="font-medium text-gray-800">
                        {step.transitDetails.lineName || '未知线路'}
                      </p>
                      <p className="text-gray-500">
                        {step.transitDetails.departureStop}
                        {' -> '}
                        {step.transitDetails.arrivalStop}
                        <span className="ml-1.5 text-gray-400">
                          · {step.transitDetails.numStops} 站
                        </span>
                      </p>
                      <p className="text-xs text-gray-400">
                        {step.duration}
                      </p>
                    </div>
                  ) : (
                    <p className="text-gray-600">
                      {step.instruction}
                      <span className="ml-1.5 text-gray-400">
                        · {step.distance} · {step.duration}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* total summary */}
      {legs.length === 1 && (
        <p className="text-center text-xs text-gray-400">
          全程 {legs[0].distance} · 约 {legs[0].duration}
        </p>
      )}
    </div>
  )
}
