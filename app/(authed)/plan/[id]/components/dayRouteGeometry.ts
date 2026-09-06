/**
 * 行程天级别的路线几何与点位收集（DayCards 预取 / DayMap 渲染共用）。
 * 模块级缓存：跨 列表/地图 tab 切换、组件重挂载复用。
 */
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'
import {
  ensureDayScheduleForRender,
  isRoutablePointItem,
  itemLatLng,
  sortItemsBySchedule,
} from './itemPayload'

export type RouteLineString = { type: 'LineString'; coordinates: [number, number][] }

export type RouteGeometryResult = { ok: true; geometry: RouteLineString } | { ok: false; error: string }

// 路线几何模块级缓存：跨 列表/地图 tab 切换、组件重挂载复用；
// DayCards 挂载时后台预取各天路线，切到地图 tab 直接命中
const routeGeometryCache = new Map<string, RouteLineString>()
const routeGeometryInflight = new Map<string, Promise<RouteGeometryResult>>()

export function routeCacheKey(planId: string, signature: string, mode: string): string {
  return `${planId}:${signature}:${mode}`
}

/** 拉取某天真实道路路线（同源 API，失败结果不缓存以便重试；同 signature 在途请求去重） */
export function fetchRouteGeometry(planId: string, signature: string, mode: 'walking' | 'driving'): Promise<RouteGeometryResult> {
  const key = routeCacheKey(planId, signature, mode)
  const cached = routeGeometryCache.get(key)
  if (cached) return Promise.resolve({ ok: true, geometry: cached })
  const inflight = routeGeometryInflight.get(key)
  if (inflight) return inflight
  const promise = (async (): Promise<RouteGeometryResult> => {
    try {
      const res = await fetch(
        `/api/me/plans/${planId}/route-geometry?points=${encodeURIComponent(signature)}&mode=${mode}`,
      )
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; geometry?: RouteLineString; error?: string }
        | null
      if (res.ok && data?.ok && data.geometry) {
        routeGeometryCache.set(key, data.geometry)
        return { ok: true, geometry: data.geometry }
      }
      // 这两条只作为失败标记在内存里流转：DayMap 只判断 error 是否存在，
      // 展示的是三语的 map.loadFailedRetry，不会把这里的中文渲染到页面上
      return { ok: false, error: data?.error ?? '路线加载失败' }
    } catch {
      return { ok: false, error: '网络错误' }
    } finally {
      routeGeometryInflight.delete(key)
    }
  })()
  routeGeometryInflight.set(key, promise)
  return promise
}

export function readRouteGeometryCache(planId: string, signature: string, mode: string): RouteLineString | null {
  return routeGeometryCache.get(routeCacheKey(planId, signature, mode)) ?? null
}

export function routeSignature(points: Array<{ lat: number; lng: number }>): string {
  return points.map((p) => `${p.lng},${p.lat}`).join('|')
}

/**
 * 条目内容签名 key（与列表 React key 同规则）：`${type}|${pointId}|${title}`，
 * 同一天内重复签名追加 `#序号`。列表条目 data-point-id 与地图 marker 的
 * data-point-id 同值，marker ↔ 条目一一对应。
 */
export function dayItemContentKeys(items: TripPlanItemView[]): string[] {
  const counts = new Map<string, number>()
  return items.map((item) => {
    const signature = `${item.type}|${item.pointId ?? ''}|${item.title}`
    const occurrence = counts.get(signature) ?? 0
    counts.set(signature, occurrence + 1)
    return occurrence > 0 ? `${signature}#${occurrence}` : signature
  })
}

/** id 与列表条目 key 同值；itemId 指回 TripPlanItemView.id（Popup 点位卡按它取图/时间/说明） */
export type DayRoutePoint = { id: string; itemId: string; lat: number; lng: number; label: string; title: string }

/** 当天参与地图/路线的点（必须有坐标：站内点位 + 外部地点）；渲染期时间兜底后排序；id 与列表条目 key 同值 */
export function dayRoutePoints(day: TripPlanDayView): DayRoutePoint[] {
  const sorted = sortItemsBySchedule(ensureDayScheduleForRender(day.items))
  const keys = dayItemContentKeys(sorted)
  const result: DayRoutePoint[] = []
  let seq = 0
  sorted.forEach((item, index) => {
    if (!isRoutablePointItem(item)) return
    const latLng = itemLatLng(item)
    if (!latLng) return
    seq += 1
    result.push({ id: keys[index]!, itemId: item.id, lat: latLng.lat, lng: latLng.lng, label: String(seq), title: item.title })
  })
  return result
}
