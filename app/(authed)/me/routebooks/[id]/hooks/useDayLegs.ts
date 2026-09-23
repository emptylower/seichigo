'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DayGeometry, DayLegsResult, RouteBookDetail } from '../types'

function parseDayGeometry(raw: unknown): DayGeometry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (row.type !== 'LineString' || !Array.isArray(row.coordinates)) return null
  const coordinates: [number, number][] = []
  for (const pair of row.coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) return null
    const lng = Number(pair[0])
    const lat = Number(pair[1])
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
    coordinates.push([lng, lat])
  }
  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null
}

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

/** 只拉选中天的 legs（服务端按天计算坐标）；切天再拉，按 dayId + 顺序签名缓存 */
export function useDayLegs(
  routeBookId: string,
  detail: RouteBookDetail | null,
  selectedDayId: string | null,
  enabled: boolean
) {
  const [legsByDay, setLegsByDay] = useState<Record<string, DayLegsResult>>({})
  const cacheRef = useRef(new Map<string, DayLegsResult>())

  const signature = useMemo(() => {
    if (!detail || !selectedDayId) return null
    if (!detail.days.some((day) => day.id === selectedDayId)) return null
    return daySignature(detail, selectedDayId)
  }, [detail, selectedDayId])

  useEffect(() => {
    if (!detail || !enabled || !selectedDayId || !signature) return
    const dayId = selectedDayId
    const cacheKey = `${dayId}|${signature}`

    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setLegsByDay((prev) => (prev[dayId] === cached ? prev : { ...prev, [dayId]: cached }))
      return
    }

    let cancelled = false
    void (async () => {
      let result: DayLegsResult | null = null
      try {
        const res = await fetch(`/api/me/routebooks/${routeBookId}/days/${dayId}/legs`)
        const data = (await res.json().catch(() => null)) as
          | {
              ok?: boolean
              stops?: DayLegsResult['stops']
              legs?: DayLegsResult['legs']
              staleTransitItemIds?: string[]
              dayGeometry?: unknown
            }
          | null
        if (res.ok && data?.ok) {
          result = {
            stops: Array.isArray(data.stops) ? data.stops : [],
            legs: Array.isArray(data.legs) ? data.legs : [],
            staleTransitItemIds: Array.isArray(data.staleTransitItemIds) ? data.staleTransitItemIds : [],
            dayGeometry: parseDayGeometry(data.dayGeometry),
          }
        }
      } catch {
        result = null
      }
      if (cancelled || !result) return
      const finalResult = result
      cacheRef.current.set(cacheKey, finalResult)
      setLegsByDay((prev) => ({ ...prev, [dayId]: finalResult }))
    })()

    return () => {
      cancelled = true
    }
  }, [detail, enabled, routeBookId, selectedDayId, signature])

  return { legsByDay }
}
