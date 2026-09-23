'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DayLegsResult, RouteBookDetail } from '../types'

/** items 顺序 + 交通方式 + 住宿 + 自定义点坐标签名；内容没变就命中缓存 */
function daySignature(detail: RouteBookDetail, dayId: string): string {
  const day = detail.days.find((row) => row.id === dayId)
  const items = detail.items
    .filter((row) => row.dayId === dayId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const itemsSig = items.map((row) => `${row.id}:${row.kind}:${row.legMode ?? ''}`).join(',')
  const lodgingSig = detail.lodgings
    .map((row) => `${row.placeId}@${row.fromDayIndex}-${row.toDayIndex}`)
    .sort()
    .join(',')
  const placeSig = detail.places
    .map((row) => `${row.id}@${row.lat.toFixed(5)},${row.lng.toFixed(5)}`)
    .sort()
    .join(',')
  return `${day?.defaultTravelMode ?? 'transit'}|${itemsSig}|${lodgingSig}|${placeSig}`
}

export function useDayLegs(routeBookId: string, detail: RouteBookDetail | null, enabled: boolean) {
  const [legsByDay, setLegsByDay] = useState<Record<string, DayLegsResult>>({})
  const cacheRef = useRef(new Map<string, DayLegsResult>())

  const signatures = useMemo(() => {
    if (!detail) return new Map<string, string>()
    return new Map(detail.days.map((day) => [day.id, daySignature(detail, day.id)]))
  }, [detail])

  useEffect(() => {
    if (!detail || !enabled) return
    let cancelled = false

    const fromCache: Record<string, DayLegsResult> = {}
    const toFetch: string[] = []
    for (const [dayId, sig] of signatures) {
      const cached = cacheRef.current.get(`${dayId}|${sig}`)
      if (cached) fromCache[dayId] = cached
      else toFetch.push(dayId)
    }

    setLegsByDay((prev) => {
      const next: Record<string, DayLegsResult> = {}
      for (const dayId of signatures.keys()) {
        const data = fromCache[dayId] ?? prev[dayId]
        if (data) next[dayId] = data
      }
      return next
    })

    if (!toFetch.length) return

    void (async () => {
      const results = await Promise.all(
        toFetch.map(async (dayId) => {
          try {
            const res = await fetch(`/api/me/routebooks/${routeBookId}/days/${dayId}/legs`)
            const data = (await res.json().catch(() => null)) as
              | { ok?: boolean; stops?: DayLegsResult['stops']; legs?: DayLegsResult['legs']; staleTransitItemIds?: string[] }
              | null
            if (!res.ok || !data?.ok) return [dayId, null] as const
            const result: DayLegsResult = {
              stops: Array.isArray(data.stops) ? data.stops : [],
              legs: Array.isArray(data.legs) ? data.legs : [],
              staleTransitItemIds: Array.isArray(data.staleTransitItemIds) ? data.staleTransitItemIds : [],
            }
            return [dayId, result] as const
          } catch {
            return [dayId, null] as const
          }
        })
      )
      if (cancelled) return
      setLegsByDay((prev) => {
        const next = { ...prev }
        for (const [dayId, result] of results) {
          if (!result) continue
          const sig = signatures.get(dayId)
          if (sig) cacheRef.current.set(`${dayId}|${sig}`, result)
          next[dayId] = result
        }
        return next
      })
    })()

    return () => {
      cancelled = true
    }
  }, [detail, enabled, routeBookId, signatures])

  return { legsByDay }
}
