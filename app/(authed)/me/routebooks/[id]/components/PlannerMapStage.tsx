'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Navigation } from 'lucide-react'
import { useDraggable, type DraggableSyntheticListeners } from '@dnd-kit/core'
// 走 Lazy 包装：MapLibre 只进客户端包，服务端渲染路径不引入（详见 RoutePreviewMapLazy 注释）
import { RoutePreviewMap } from '@/components/route/RoutePreviewMapLazy'
import type { MarkerVariant } from '@/components/route/routePreviewMarkers'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DayLegsResult, ItemRecord, PlaceKind, PointPreview, RouteBookDetail } from '../types'
import { computeVisitOrder, dayLabel, markerDragId } from '../utils'
import { useRouteGeometry } from '../hooks/useRouteGeometry'
import { tr } from '../../i18n'

type PlannerMapStageProps = {
  detail: RouteBookDetail
  selectedDayId: string | null
  getPointPreview: (pointId: string) => PointPreview
  legsByDay: Record<string, DayLegsResult>
  /** 选中天的 legs 正在重拉 / 两次失败：画本地直连虚线代替服务端数据 */
  legsStale?: boolean
  legsFailed?: boolean
  routeVisible: boolean
  compact?: boolean
  startLabel: string
  startDisabled?: boolean
  onStartImmersive: () => void
  /** 右栏「已安排」点击聚焦的条目 id（marker 高亮 + easeTo） */
  activePointId?: string | null
  /** B4：点 marker 打开点位详情卡（再点同一 marker 关闭由调用方控制） */
  onPointSelect?: (itemId: string) => void
  /** B4：地图左下角（移动端底部抽屉）点位详情卡，由 ui.tsx 组装 */
  detailCard?: React.ReactNode
  locale?: SupportedLocale
}

type MapPoint = { id: string; lat: number; lng: number; label: string; title?: string }

/** 隐藏代理：marker 是命令式 DOM，借它把 marker 的 pointer 事件接进 dnd-kit。
 *  代理不能用 display:none（dnd-kit 量到 0×0，overlay/碰撞会偏移）：
 *  常态 fixed 放到屏外、opacity 0；pointerdown 时被移到 marker 的 rect 上。 */
function MarkerDragProxy({
  itemId,
  register,
}: {
  itemId: string
  register: (itemId: string, listeners: DraggableSyntheticListeners | undefined, node: HTMLElement | null) => void
}) {
  const { listeners, setNodeRef } = useDraggable({ id: markerDragId(itemId) })
  const nodeRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    register(itemId, listeners, nodeRef.current)
    return () => register(itemId, undefined, null)
  }, [itemId, listeners, register])
  return (
    <div
      ref={(el) => {
        nodeRef.current = el
        setNodeRef(el)
      }}
      aria-hidden
      className="pointer-events-none fixed opacity-0"
      style={{ left: -9999, top: 0, width: 24, height: 24 }}
    />
  )
}

function placeKindOf(item: ItemRecord, detail: RouteBookDetail): PlaceKind | null {
  if (item.kind !== 'place' || !item.placeId) return null
  return detail.places.find((row) => row.id === item.placeId)?.kind ?? null
}

export function PlannerMapStage({
  detail,
  selectedDayId,
  getPointPreview,
  legsByDay,
  legsStale = false,
  legsFailed = false,
  routeVisible,
  compact = false,
  startLabel,
  startDisabled = false,
  onStartImmersive,
  activePointId = null,
  onPointSelect,
  detailCard,
  locale = 'zh',
}: PlannerMapStageProps) {
  const proxyListenersRef = useRef(new Map<string, DraggableSyntheticListeners | undefined>())
  const proxyNodesRef = useRef(new Map<string, HTMLElement | null>())
  const registerProxy = useCallback(
    (itemId: string, listeners: DraggableSyntheticListeners | undefined, node: HTMLElement | null) => {
      if (listeners) proxyListenersRef.current.set(itemId, listeners)
      else proxyListenersRef.current.delete(itemId)
      if (node) proxyNodesRef.current.set(itemId, node)
      else proxyNodesRef.current.delete(itemId)
    },
    []
  )

  const selectedDay = detail.days.find((day) => day.id === selectedDayId) ?? null
  // stale / 失败期间不给服务端数据，useRouteGeometry 会用本地直连虚线占位
  const dayLegs =
    selectedDayId && !legsStale && !legsFailed ? legsByDay[selectedDayId] : undefined

  // 本地直连虚线的站点顺序：该天有坐标的 point/place 按 sortOrder（不等服务端）
  const fallbackStops = useMemo(() => {
    if (selectedDayId === null) return []
    const dayItems = detail.items.filter((item) => item.dayId === selectedDayId)
    const order = computeVisitOrder(dayItems, detail.places, getPointPreview)
    return dayItems
      .filter((item) => order.has(item.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => {
        if (item.kind === 'place' && item.placeId) {
          const place = detail.places.find((row) => row.id === item.placeId)
          return place ? { lat: place.lat, lng: place.lng } : null
        }
        const geo = item.pointId ? getPointPreview(item.pointId).geo : null
        return geo ? { lat: geo[0], lng: geo[1] } : null
      })
      .filter((stop): stop is { lat: number; lng: number } => stop !== null)
  }, [detail, getPointPreview, selectedDayId])

  // 全部模式（selectedDayId=null）：不画路线；单天模式：dayGeometry 实线优先，legs 分段兜底
  const { dayGeometry, legs } = useRouteGeometry(dayLegs, routeVisible, fallbackStops)

  const { mapPoints, markerVariants, markerImages } = useMemo(() => {
    const dayIndexById = new Map(detail.days.map((day) => [day.id, day.dayIndex]))
    const dayIndexesByPointId = new Map<string, number[]>()
    for (const item of detail.items) {
      if (item.kind !== 'point' || !item.pointId || !item.dayId) continue
      const dayIndex = dayIndexById.get(item.dayId)
      if (dayIndex === undefined) continue
      const list = dayIndexesByPointId.get(item.pointId) ?? []
      list.push(dayIndex)
      dayIndexesByPointId.set(item.pointId, list)
    }

    // 单天模式：徽标 = 该天内游览顺序（只数有坐标的 point/place），与时间线序号一致
    const visitOrder =
      selectedDayId === null
        ? null
        : computeVisitOrder(
            detail.items.filter((item) => item.dayId === selectedDayId),
            detail.places,
            getPointPreview
          )

    const badgeFor = (item: ItemRecord): string => {
      if (visitOrder) {
        const order = visitOrder.get(item.id)
        return order !== undefined ? String(order) : '·'
      }
      if (item.kind === 'point' && item.pointId) {
        const indexes = [...new Set(dayIndexesByPointId.get(item.pointId) ?? [])].sort((a, b) => a - b)
        if (indexes.length) return indexes.join('·')
      }
      const dayIndex = item.dayId ? dayIndexById.get(item.dayId) : undefined
      return dayIndex !== undefined ? String(dayIndex) : '·'
    }

    const points: MapPoint[] = []
    const variants: Record<string, MarkerVariant> = {}
    const images: Record<string, string | null> = {}
    for (const item of detail.items) {
      if (item.kind !== 'point' && item.kind !== 'place') continue
      // 单天模式：其它天与未安排的标记全部不渲染（不是变淡）
      if (selectedDayId !== null && item.dayId !== selectedDayId) continue
      let lat: number | null = null
      let lng: number | null = null
      let title: string | undefined
      let image: string | null = null
      if (item.kind === 'point' && item.pointId) {
        const preview = getPointPreview(item.pointId)
        if (preview.geo) [lat, lng] = preview.geo
        title = preview.title
        image = preview.image
      } else if (item.kind === 'place' && item.placeId) {
        const place = detail.places.find((row) => row.id === item.placeId)
        if (place) {
          lat = place.lat
          lng = place.lng
          title = place.title
        }
      }
      if (lat === null || lng === null) continue
      const badge = badgeFor(item)
      points.push({ id: item.id, lat, lng, label: badge, title })
      // 全部模式：已安排=active，未安排=hollow；单天模式：当天一律 active
      const emphasis =
        selectedDayId === null
          ? item.dayId === null
            ? 'hollow'
            : 'active'
          : 'active'
      variants[item.id] = {
        badge,
        emphasis,
        placeKind: placeKindOf(item, detail),
      }
      images[item.id] = image
    }
    return { mapPoints: points, markerVariants: variants, markerImages: images }
  }, [detail, getPointPreview, selectedDayId])

  const handleMarkerPointerDown = useCallback((pointKey: string, event: PointerEvent) => {
    // 先把代理元素贴到 marker 的 rect 上（同尺寸、不可见），再转发给 dnd-kit：
    // 拖拽激活量到的就是 marker 位置，overlay 与碰撞检测不再偏移
    const markerEl =
      event.target instanceof HTMLElement ? (event.target.closest('.route-preview-marker') ?? event.target) : null
    const proxy = proxyNodesRef.current.get(pointKey)
    if (markerEl && proxy) {
      const rect = markerEl.getBoundingClientRect()
      proxy.style.left = `${rect.left}px`
      proxy.style.top = `${rect.top}px`
      proxy.style.width = `${rect.width}px`
      proxy.style.height = `${rect.height}px`
    }
    const onPointerDown = proxyListenersRef.current.get(pointKey)?.onPointerDown as
      | ((e: { nativeEvent: PointerEvent }) => void)
      | undefined
    onPointerDown?.({ nativeEvent: event })
  }, [])

  const dayCount = detail.days.length
  const headerSubtitle = selectedDay
    ? `${dayLabel(selectedDay, selectedDay.dayIndex, locale)} · ${tr('routebook.map.subtitleDayCount', locale, { n: dayCount })}`
    : tr('routebook.map.subtitleAll', locale, { n: dayCount })

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[32px] border border-pink-100/90 bg-white/95 p-4 shadow-[0_24px_44px_-34px_rgba(15,23,42,0.38)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-pink-50 text-brand-600">
            <Navigation className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{tr('routebook.map.title', locale)}</h2>
            <p className="text-xs text-slate-500">{headerSubtitle}</p>
          </div>
        </div>
        <span className="inline-flex rounded-full border border-pink-100 bg-pink-50/60 px-3 py-1 text-xs font-semibold text-brand-600">
          {selectedDayId === null
            ? tr('routebook.map.badgeAll', locale)
            : routeVisible
              ? tr('routebook.map.routeOn', locale)
              : tr('routebook.map.routeOff', locale)}
        </span>
      </div>

      <div className={`relative overflow-hidden rounded-[28px] border border-pink-100/80 bg-slate-100 ${compact ? 'min-h-[17rem]' : 'min-h-0 flex-1'}`}>
        {mapPoints.length > 0 ? (
          <RoutePreviewMap
            points={mapPoints}
            routeGeometry={dayGeometry}
            legs={selectedDayId === null ? [] : dayGeometry ? undefined : legs}
            markerVariants={markerVariants}
            markerImages={markerImages}
            onMarkerPointerDown={handleMarkerPointerDown}
            activePointId={activePointId}
            onPointSelect={onPointSelect}
            className="absolute inset-0 h-full w-full"
            compact={compact}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_top,#fff1f7,transparent_55%),linear-gradient(180deg,#f8fafc,#fdf2f8)] px-8 text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white text-brand-500 shadow-sm">
              <Navigation className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-900">{tr('routebook.map.emptyTitle', locale)}</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
              {tr('routebook.map.emptyBody', locale)}
            </p>
          </div>
        )}

        {/* marker 拖拽代理（不可见） */}
        {mapPoints.map((point) => (
          <MarkerDragProxy key={point.id} itemId={point.id} register={registerProxy} />
        ))}

        {/* B4：点位详情卡（浮在地图左下角 / 移动端底部抽屉） */}
        {detailCard}
      </div>

      <div className="mt-3">
        <button
          type="button"
          disabled={startDisabled}
          className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-[24px] bg-brand-400 px-6 text-base font-semibold text-white shadow-[0_18px_34px_-22px_rgba(225,29,72,0.7)] transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          onClick={onStartImmersive}
        >
          <Navigation className="h-5 w-5" />
          {startLabel}
        </button>
      </div>
    </section>
  )
}
