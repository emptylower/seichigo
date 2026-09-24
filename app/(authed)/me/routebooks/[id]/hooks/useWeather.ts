'use client'

import { useEffect, useMemo, useState } from 'react'
import type { WeatherDay } from '@/lib/weather/openMeteo'
import type { DayRecord, PointPreview, RouteBookDetail } from '../types'

export type { WeatherDay }
export type WeatherByDate = Record<string, WeatherDay>

type WeatherSource = Pick<RouteBookDetail, 'id' | 'days' | 'items' | 'places' | 'lodgings'>

export const CACHE_TTL_MS = 60 * 60 * 1000
/** 空结果（上游暂无数据）只缓存 5 分钟，避免一次空响应压住一小时 */
export const EMPTY_CACHE_TTL_MS = 5 * 60 * 1000
/** 预报窗口（今天..今天+15）外留一天余量，时区差不至于误杀 */
const FORECAST_DAYS = 16

type CacheEntry = { at: number; key: string; days: WeatherDay[] }
const cache = new Map<string, CacheEntry>()

/** 测试用：清空按行程本缓存 */
export function clearWeatherCache(): void {
  cache.clear()
}

/** ISO 日期 → YYYY-MM-DD（按 UTC 读，与 dayLabel 一致）；无日期或非法返回 null */
export function weatherDateKey(date: string | null): string | null {
  if (!date) return null
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

export function weatherForDay(byDate: WeatherByDate, day: Pick<DayRecord, 'date'> | null): WeatherDay | null {
  const key = day ? weatherDateKey(day.date) : null
  return key ? byDate[key] ?? null : null
}

/** 天气坐标：按天序第一个有坐标的 point/place 条目；都没有时取第一段住宿的自定义点 */
export function weatherAnchor(
  source: Pick<RouteBookDetail, 'days' | 'items' | 'places' | 'lodgings'>,
  getPointPreview: (pointId: string) => Pick<PointPreview, 'geo'>
): { lat: number; lng: number } | null {
  const dayOrder = new Map(source.days.map((day) => [day.id, day.dayIndex]))
  const scheduled = source.items
    .filter((item) => item.dayId !== null && dayOrder.has(item.dayId))
    .sort((a, b) => dayOrder.get(a.dayId!)! - dayOrder.get(b.dayId!)! || a.sortOrder - b.sortOrder)
  for (const item of scheduled) {
    if (item.kind === 'place') {
      const place = source.places.find((row) => row.id === item.placeId)
      if (place) return { lat: place.lat, lng: place.lng }
    }
    if (item.kind === 'point' && item.pointId) {
      const geo = getPointPreview(item.pointId).geo
      if (geo) return { lat: geo[0], lng: geo[1] }
    }
  }
  const lodging = [...source.lodgings].sort((a, b) => a.fromDayIndex - b.fromDayIndex)[0]
  const place = lodging ? source.places.find((row) => row.id === lodging.placeId) : null
  return place ? { lat: place.lat, lng: place.lng } : null
}

function addDaysKey(key: string, delta: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10)
}

/**
 * 行程本每天天气（按 YYYY-MM-DD 索引）。只有带日期的行程才请求；日期整段落在
 * 预报窗口外也不请求；结果按行程本在内存缓存 1 小时（空结果 5 分钟；坐标/日期范围变了才重拉）。
 * 请求失败（!res.ok）清掉旧数据，不留上一次的天气。
 */
export function useWeather(
  detail: WeatherSource | null,
  getPointPreview: (pointId: string) => Pick<PointPreview, 'geo'>
): WeatherByDate {
  const [days, setDays] = useState<WeatherDay[]>([])

  // 请求参数压成字符串：getPointPreview 引用随预览加载变化时，参数不变就不重跑 effect
  const requestKey = useMemo(() => {
    if (!detail) return null
    const keys = detail.days
      .map((day) => weatherDateKey(day.date))
      .filter((key): key is string => key !== null)
      .sort()
    if (keys.length === 0) return null
    const anchor = weatherAnchor(detail, getPointPreview)
    if (!anchor) return null
    const from = keys[0]!
    const to = keys[keys.length - 1]!
    // 坐标取 2 位小数（~1km）：点位预览陆续到达时不因微小差异重拉
    const lat = anchor.lat.toFixed(2)
    const lng = anchor.lng.toFixed(2)
    return [detail.id, lat, lng, from, to].join('|')
  }, [detail, getPointPreview])

  useEffect(() => {
    if (!requestKey) {
      setDays([])
      return
    }
    const [routeBookId = '', lat = '', lng = '', from = '', to = ''] = requestKey.split('|')
    const request = { routeBookId, lat, lng, from, to, key: requestKey }
    const today = new Date().toISOString().slice(0, 10)
    if (request.to < addDaysKey(today, -1) || request.from > addDaysKey(today, FORECAST_DAYS)) {
      setDays([])
      return
    }
    const cached = cache.get(request.routeBookId)
    const ttl = cached && cached.days.length === 0 ? EMPTY_CACHE_TTL_MS : CACHE_TTL_MS
    if (cached && cached.key === request.key && Date.now() - cached.at < ttl) {
      setDays(cached.days)
      return
    }

    let cancelled = false
    const params = new URLSearchParams({ lat: request.lat, lng: request.lng, from: request.from, to: request.to })
    void (async () => {
      try {
        const res = await fetch(`/api/weather?${params.toString()}`)
        if (!res.ok) {
          cache.delete(request.routeBookId)
          if (!cancelled) setDays([])
          return
        }
        const data = (await res.json().catch(() => null)) as { ok?: boolean; days?: WeatherDay[] } | null
        const next = data?.ok && Array.isArray(data.days) ? data.days : []
        cache.set(request.routeBookId, { at: Date.now(), key: request.key, days: next })
        if (!cancelled) setDays(next)
      } catch {
        // 天气只是锦上添花：失败静默
      }
    })()
    return () => {
      cancelled = true
    }
  }, [requestKey])

  return useMemo(() => {
    const out: WeatherByDate = {}
    for (const day of days) out[day.date] = day
    return out
  }, [days])
}
