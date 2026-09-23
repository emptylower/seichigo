'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DayGeometry, DayLegsResult, RouteBookDetail } from '../types'

const FETCH_TIMEOUT_MS = 15000
const RETRY_DELAY_MS = 1000

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

/** FNV-1a 32 位哈希 → 8 位 hex；把长顺序签名压成 ≤64 字符的不透明 key 给服务端缓存用 */
export function legsSigHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export type DayLegsState = {
  legsByDay: Record<string, DayLegsResult>
  /** 签名变了、新响应未回：旧数据仅供占位，地图应画本地虚线 */
  staleDayIds: Record<string, boolean>
  /** 两次尝试都失败：保留虚线 + 连接行给重试入口 */
  failedDayIds: Record<string, boolean>
  retryDay: (dayId: string) => void
}

/** 只拉选中天的 legs（服务端按天计算坐标）；切天再拉，按 dayId + 顺序签名缓存 */
export function useDayLegs(
  routeBookId: string,
  detail: RouteBookDetail | null,
  selectedDayId: string | null,
  enabled: boolean
): DayLegsState {
  const [legsByDay, setLegsByDay] = useState<Record<string, DayLegsResult>>({})
  const [staleDayIds, setStaleDayIds] = useState<Record<string, boolean>>({})
  const [failedDayIds, setFailedDayIds] = useState<Record<string, boolean>>({})
  const [retryNonce, setRetryNonce] = useState(0)
  const cacheRef = useRef(new Map<string, DayLegsResult>())

  const signature = useMemo(() => {
    if (!detail || !selectedDayId) return null
    if (!detail.days.some((day) => day.id === selectedDayId)) return null
    return daySignature(detail, selectedDayId)
  }, [detail, selectedDayId])

  // 服务端缓存 key（A2）：命中时跳过 Mapbox；只对服务端暴露哈希，签名本体含条目顺序/交通方式/住宿锚点
  const serverSig = useMemo(() => (signature ? legsSigHash(signature) : null), [signature])

  const retryDay = useCallback((dayId: string) => {
    setFailedDayIds((prev) => (prev[dayId] ? { ...prev, [dayId]: false } : prev))
    setRetryNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!enabled || !selectedDayId || !signature || !serverSig) return
    const dayId = selectedDayId
    const cacheKey = `${dayId}|${signature}`

    const clearStale = () => setStaleDayIds((prev) => (prev[dayId] ? { ...prev, [dayId]: false } : prev))
    const clearFailed = () => setFailedDayIds((prev) => (prev[dayId] ? { ...prev, [dayId]: false } : prev))

    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setLegsByDay((prev) => (prev[dayId] === cached ? prev : { ...prev, [dayId]: cached }))
      clearStale()
      clearFailed()
      return
    }

    // 新签名发起请求：标 stale，期间由地图用本地直连虚线占位
    setStaleDayIds((prev) => ({ ...prev, [dayId]: true }))

    let cancelled = false
    const controllers: AbortController[] = []
    let retryTimer: number | null = null

    const attempt = async (): Promise<DayLegsResult | null> => {
      const controller = new AbortController()
      controllers.push(controller)
      const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      try {
        const res = await fetch(
          `/api/me/routebooks/${routeBookId}/days/${dayId}/legs?sig=${encodeURIComponent(serverSig)}`,
          { signal: controller.signal }
        )
        const data = (await res.json().catch(() => null)) as
          | {
              ok?: boolean
              stops?: DayLegsResult['stops']
              legs?: DayLegsResult['legs']
              staleTransitItemIds?: string[]
              dayGeometry?: unknown
            }
          | null
        if (!res.ok || !data?.ok) return null
        return {
          stops: Array.isArray(data.stops) ? data.stops : [],
          legs: Array.isArray(data.legs) ? data.legs : [],
          staleTransitItemIds: Array.isArray(data.staleTransitItemIds) ? data.staleTransitItemIds : [],
          dayGeometry: parseDayGeometry(data.dayGeometry),
        }
      } catch {
        return null
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    void (async () => {
      let result = await attempt()
      if (!result && !cancelled) {
        // 失败（非 200 / 网络 / 超时）→ 1 秒后自动重试一次
        await new Promise<void>((resolve) => {
          retryTimer = window.setTimeout(resolve, RETRY_DELAY_MS)
        })
        if (!cancelled) result = await attempt()
      }
      if (cancelled) return
      if (!result) {
        setStaleDayIds((prev) => (prev[dayId] ? { ...prev, [dayId]: false } : prev))
        setFailedDayIds((prev) => ({ ...prev, [dayId]: true }))
        return
      }
      const finalResult = result
      cacheRef.current.set(cacheKey, finalResult)
      setLegsByDay((prev) => ({ ...prev, [dayId]: finalResult }))
      setStaleDayIds((prev) => (prev[dayId] ? { ...prev, [dayId]: false } : prev))
      setFailedDayIds((prev) => (prev[dayId] ? { ...prev, [dayId]: false } : prev))
    })()

    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      for (const controller of controllers) controller.abort()
    }
  }, [enabled, routeBookId, selectedDayId, signature, serverSig, retryNonce])

  return { legsByDay, staleDayIds, failedDayIds, retryDay }
}
