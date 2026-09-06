'use client'

import { useEffect, useRef, type MutableRefObject } from 'react'
import { X } from 'lucide-react'
import { RoutePreviewMap } from '@/components/route/RoutePreviewMap'
import type { DayRoutePoint, RouteLineString } from './dayRouteGeometry'
import type { PreviewPopupControls } from '@/components/route/routePreviewPopup'
import type { SupportedLocale } from '@/lib/i18n/types'
import { planTextFor } from '../lib/planText'
import { TierHint } from '@/components/billing/TierHint'

/**
 * 单日路线全屏展开态：inline 态是协作手势（防滚动劫持），完整交互（缩放/平移）
 * 在展开态进行。Esc 关闭；遮罩期间 body overflow-hidden。
 */
export function DayMapExpanded(props: {
  dayIndex: number
  points: DayRoutePoint[]
  routeGeometry: RouteLineString | null
  activePointId?: string | null
  /** marker 点选（与 inline 态同一套 activePointId 联动） */
  onPointSelect?: (id: string) => void
  /** Popup 内容：DayMap 为展开态单独持有的点位卡宿主（L2：与 inline 态互不顶掉） */
  renderPopup?: (id: string) => HTMLElement | null
  /** Popup 被地图关闭时通知宿主（H3） */
  onPopupClosed?: (id: string) => void
  /** 点位卡「关闭」用的地图侧入口（H3/L1） */
  popupControlsRef?: MutableRefObject<PreviewPopupControls | null>
  onClose: () => void
  /** 免费档只有估算路线时，标题旁给一个升级入口（与 inline 态同一开关） */
  showMapUpgradeHint?: boolean
  locale?: SupportedLocale
}) {
  const { dayIndex, points, routeGeometry, activePointId = null, onPointSelect, renderPopup, onClose } = props
  const tx = planTextFor(props.locale ?? 'zh')
  const title = tx('map.dayRouteTitle', { day: dayIndex })
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // L13：焦点管理——打开时移到关闭按钮，关闭时还原到触发元素（「展开」按钮）
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()
    return () => {
      trigger?.focus()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-white">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold text-gray-900">{title}</h2>
          {props.showMapUpgradeHint ? <TierHint kind="map" /> : null}
        </div>
        <button
          type="button"
          ref={closeButtonRef}
          aria-label={tx('common.close')}
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <RoutePreviewMap
          points={points}
          routeGeometry={routeGeometry}
          interactive
          activePointId={activePointId}
          onPointSelect={onPointSelect}
          renderPopup={renderPopup}
          onPopupClosed={props.onPopupClosed}
          popupControlsRef={props.popupControlsRef}
          className="h-full w-full"
        />
      </div>
    </div>
  )
}
