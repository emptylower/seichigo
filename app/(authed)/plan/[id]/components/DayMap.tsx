'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Maximize2 } from 'lucide-react'
import { RoutePreviewMap } from '@/components/route/RoutePreviewMap'
import { MapErrorBoundary } from '@/components/MapErrorBoundary'
import { dayTravelMode, ensureDayScheduleForRender, sortItemsBySchedule } from './itemPayload'
import { composeDayRoute } from './dayRouteCompose'
import {
  dayRoutePoints,
  fetchRouteGeometry,
  readRouteGeometryCache,
  routeSignature,
  type RouteLineString,
} from './dayRouteGeometry'
import { DayMapExpanded } from './DayMapExpanded'
import { useDayPointPopup } from '../hooks/useDayPointPopup'
import type { TripPlanDayView } from '@/lib/tripPlan/view'

/**
 * 单日地图（inline 协作手势 + 右上"展开"全屏全交互）。
 * 路线优先用 provider 几何（estimate_travel 落库折线）：有折线的段用真实路线、
 * 缺折线的段用直线补齐（coverage=mixed 时标注"部分示意"）；一段折线都没有
 * 才请求通用路网。
 */
export function DayMap(props: {
  planId: string
  day: TripPlanDayView
  activePointId?: string | null
  /** marker 被点选（只设 activePointId，不切 tab） */
  onPointSelect?: (id: string) => void
  /** Popup 里「查看条目」按钮的回调：切回列表、滚动到条目并闪烁高亮环 */
  onRequestShowItem?: (id: string) => void
}) {
  const { planId, day, activePointId = null, onPointSelect, onRequestShowItem } = props
  const [geometry, setGeometry] = useState<RouteLineString | null>(null)
  const [sourceLabel, setSourceLabel] = useState<'provider' | 'mixed' | 'fallback' | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const [expanded, setExpanded] = useState(false)

  // 当天参与路线的点（id 与列表条目 key 同值，序号与列表徽标一致）
  const dayPoints = useMemo(() => dayRoutePoints(day), [day])
  // 与时间线同源的出行模式：任何自驾段 → driving，否则 walking
  const mode = useMemo(() => dayTravelMode(day.items), [day])
  // §0 点位卡数据：与列表同一份「渲染期时间兜底 + 排序」后的条目，按 itemId 取图/时间/说明
  const dayItems = useMemo(() => sortItemsBySchedule(ensureDayScheduleForRender(day.items)), [day])

  // R2：逐段拼路线——有 provider 折线的段用真实路线，其余段用直线补齐
  const composed = useMemo(() => composeDayRoute(dayPoints, day.items), [dayPoints, day])

  // M11 marker Popup：把一个空容器交给 maplibre，内容由 React portal 渲染成点位卡。
  // L2：inline 与展开态各持一份宿主（两张地图可同时在场），互不顶掉。
  const inlinePopup = useDayPointPopup({ points: dayPoints, items: dayItems, onRequestShowItem })
  const expandedPopup = useDayPointPopup({ points: dayPoints, items: dayItems, onRequestShowItem })

  const signature = routeSignature(dayPoints)

  useEffect(() => {
    if (dayPoints.length < 2) {
      setGeometry(null)
      setSourceLabel(null)
      setError(null)
      setLoading(false)
      return
    }
    if (composed.coverage !== 'none') {
      // 权威 provider 几何（部分段可能是直线补齐）：与时间线同源，不再请求通用路网
      setGeometry({ type: 'LineString', coordinates: composed.coordinates })
      setSourceLabel(composed.coverage)
      setError(null)
      setLoading(false)
      return
    }
    // 预取/上次渲染可能已填充模块级缓存，命中即同步展示
    const cached = readRouteGeometryCache(planId, signature, mode)
    if (cached) {
      setGeometry(cached)
      setSourceLabel('fallback')
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void fetchRouteGeometry(planId, signature, mode).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setGeometry(result.geometry)
        setSourceLabel('fallback')
        setError(null)
      } else {
        setGeometry(null)
        setSourceLabel(null)
        setError(result.error)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // retryToken 手动重试；signature/mode 变化（切天/plan 更新）自动重取
  }, [planId, signature, mode, dayPoints.length, composed, retryToken])

  if (!dayPoints.length) {
    return (
      <div className="mx-4 mb-4 flex h-40 items-center justify-center rounded-2xl bg-gray-50 text-xs text-gray-400">
        当天还没有带坐标的点位
      </div>
    )
  }

  return (
    <div className="relative mx-4 mb-4 h-64 sm:h-80">
      <MapErrorBoundary className="h-full w-full overflow-hidden rounded-2xl" points={dayPoints}>
        <RoutePreviewMap
          points={dayPoints}
          routeGeometry={geometry}
          interactive={false}
          activePointId={activePointId}
          onPointSelect={onPointSelect}
          renderPopup={inlinePopup.renderPopup}
          onPopupClosed={inlinePopup.onPopupClosed}
          popupControlsRef={inlinePopup.popupControlsRef}
          className="h-full w-full overflow-hidden rounded-2xl"
        />
      </MapErrorBoundary>
      {/* M5 布局避让：缩放控件在右上；「展开」右下；加载中左上；示意标注左上第二行；失败重试左下 */}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-gray-600 shadow-sm hover:bg-white"
      >
        <Maximize2 className="h-3 w-3" />
        展开
      </button>
      {sourceLabel === 'fallback' || sourceLabel === 'mixed' ? (
        <div
          className="pointer-events-none absolute left-3 top-9 rounded-full bg-white/90 px-2.5 py-1 text-[11px] text-gray-400 shadow-sm"
          title={
            sourceLabel === 'mixed'
              ? '部分路段没有权威路线数据，用直线连接示意'
              : '未取到所选交通方式的权威路线，按路网示意连接'
          }
        >
          {sourceLabel === 'mixed' ? '部分示意' : '参考路线（示意）'}
        </div>
      ) : null}
      {loading ? (
        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] text-gray-500 shadow-sm">
          <Loader2 className="h-3 w-3 animate-spin" />
          路线加载中…
        </div>
      ) : null}
      {!loading && error ? (
        <button
          type="button"
          onClick={() => setRetryToken((t) => t + 1)}
          className="absolute bottom-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-red-500 shadow-sm"
        >
          路线加载失败 · 重试
        </button>
      ) : null}
      {inlinePopup.card}
      {expanded ? (
        <>
          <DayMapExpanded
            dayIndex={day.dayIndex}
            points={dayPoints}
            routeGeometry={geometry}
            activePointId={activePointId}
            onPointSelect={onPointSelect}
            renderPopup={expandedPopup.renderPopup}
            onPopupClosed={expandedPopup.onPopupClosed}
            popupControlsRef={expandedPopup.popupControlsRef}
            onClose={() => setExpanded(false)}
          />
          {expandedPopup.card}
        </>
      ) : null}
    </div>
  )
}
