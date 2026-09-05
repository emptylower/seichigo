'use client'

import { useCallback, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DayPointCard } from '../components/DayPointCard'
import type { DayRoutePoint } from '../components/dayRouteGeometry'
import type { PreviewPopupControls } from '@/components/route/routePreviewPopup'
import type { TripPlanItemView } from '@/lib/tripPlan/view'

export type DayPointPopup = {
  /** 交给 RoutePreviewMap：只记住 (id, 空容器)，内容由 React portal 渲染成点位卡 */
  renderPopup: (id: string) => HTMLElement
  /** 交给 RoutePreviewMap：地图侧关闭（原生按钮/点空白/marker 重建/切天/卸载）时撤掉宿主 */
  onPopupClosed: (id: string) => void
  /** 交给 RoutePreviewMap：卡片右上「关闭」经此关掉地图 Popup */
  popupControlsRef: MutableRefObject<PreviewPopupControls | null>
  /** 点位卡 portal（无 Popup 时为 null），由调用方直接渲染 */
  card: ReactNode
}

/**
 * 单张地图的 Popup 宿主（L2）：inline 态与展开态各调一次，两张地图同时在场时
 * 不再共用一个宿主互相顶掉。卡片本体在每次渲染里查最新 points/items，天/行程
 * 更新后已开的 Popup 内容跟着走，且不需要手工管理第二个 React root。
 */
export function useDayPointPopup(input: {
  points: DayRoutePoint[]
  items: TripPlanItemView[]
  /** Popup 里「查看条目」按钮的回调：切回列表、滚动到条目并闪烁高亮环 */
  onRequestShowItem?: (id: string) => void
}): DayPointPopup {
  const [host, setHost] = useState<{ id: string; el: HTMLElement } | null>(null)
  const popupControlsRef = useRef<PreviewPopupControls | null>(null)
  const onRequestShowItemRef = useRef(input.onRequestShowItem)
  onRequestShowItemRef.current = input.onRequestShowItem

  const renderPopup = useCallback((id: string): HTMLElement => {
    const el = document.createElement('div')
    setHost({ id, el })
    return el
  }, [])

  // H3：关掉的确实是当前这张卡时才撤宿主——新 Popup 顶掉旧的会先发旧 id 的 close
  const onPopupClosed = useCallback((id: string) => {
    setHost((cur) => (cur && cur.id === id ? null : cur))
  }, [])

  // L1：DOM 副作用（关掉地图侧 Popup）留在事件处理里，不写进 setState 的 updater
  const closeCard = useCallback(() => {
    setHost(null)
    popupControlsRef.current?.close()
  }, [])

  const point = host ? input.points.find((candidate) => candidate.id === host.id) ?? null : null
  const card =
    host && point
      ? createPortal(
          <DayPointCard
            item={input.items.find((candidate) => candidate.id === point.itemId) ?? null}
            title={point.title || point.label}
            lat={point.lat}
            lng={point.lng}
            onShowItem={onRequestShowItemRef.current ? () => onRequestShowItemRef.current?.(point.id) : undefined}
            onClose={closeCard}
          />,
          host.el,
        )
      : null

  return { renderPopup, onPopupClosed, popupControlsRef, card }
}
