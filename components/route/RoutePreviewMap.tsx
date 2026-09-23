'use client'

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { isWebglContextError } from './mapAvailability'
import { MapUnavailablePlaceholder } from './MapUnavailablePlaceholder'
import {
  getMapStyleFailoverTimeoutMs,
  getRouteMapStyleCandidates,
  RouteMapStyleFailover,
  shouldResyncRoutePreviewOnStyleEvent,
  type RouteStyleResyncEvent,
} from './mapStyleFailover'
import { createPendingSync, type PendingSync } from './routePreviewSync'
import {
  bindPopupClose,
  createPreviewPopupLifecycle,
  needsActivePopupSync,
  type PreviewPopupControls,
  type PreviewPopupLifecycle,
} from './routePreviewPopup'
import {
  applyMarkerActive,
  distanceMeters,
  type MarkerLayout,
  type MarkerVariant,
  type RoutePreviewPoint,
} from './routePreviewMarkers'
import { rebuildRouteMarkers, type RouteMarkerEntry } from './routePreviewMarkersRebuild'
import {
  buildPreviewData,
  buildRenderSignature,
  fitMapToPreview,
  syncPreviewSources,
  PREVIEW_DEFAULT_CENTER,
  ROUTE_SPREAD_HINT_METERS,
  type RoutePreviewLeg,
} from './routePreviewLayers'
import { bindMapContextMenu } from './routePreviewContextMenu'
import { createRoutePreviewMap } from './routePreviewMapInit'

export interface RoutePreviewMapProps {
  /**
   * id 与列表条目一一对应（DayCards 用内容签名）。可选以兼容未接入联动的
   * 旧调用方（如路书详情页）：缺省回退 `idx-${index}`。
   */
  points: Array<{ id?: string; lat: number; lng: number; label: string; title?: string }>
  routeGeometry: { type: 'LineString'; coordinates: [number, number][] } | null
  className?: string
  compact?: boolean
  /** 高亮的点（marker 放大 + 主色环）；该点不在当前视口内时 easeTo 过去，并自动打开该点 Popup */
  activePointId?: string | null
  /**
   * marker 被点选（M3 语义修订）：只通知选中——调用方负责设 activePointId，
   * 不在此切 tab/滚动列表（切换由 Popup 里的「查看条目」按钮触发）。
   */
  onPointSelect?: (id: string) => void
  /** 自定义 marker Popup 内容（如标题 + 「查看条目」按钮）；缺省/返回 null 时回退标题文本 */
  renderPopup?: (id: string) => HTMLElement | null
  /**
   * H3：Popup 关闭后的通知（原生关闭按钮、点击空白、marker 重建/切天、卸载都会发）。
   * renderPopup 的调用方据此撤掉自定义内容宿主，并让同一 marker 能再次打开。
   */
  onPopupClosed?: (id: string) => void
  /** H3/L1：Popup 关闭入口（点位卡右上角「关闭」用），挂载时写入、卸载时置空 */
  popupControlsRef?: MutableRefObject<PreviewPopupControls | null>
  /**
   * 手势交互开关（mount 时生效）。默认 true 保持既有全交互行为；
   * false 用于 inline 嵌入可滚动页面的场景：启用 cooperativeGestures
   * （Ctrl/⌘+滚轮缩放、单指拖动页面滚动、双指操作地图），boxZoom/keyboard/
   * doubleClickZoom 仍禁用，避免劫持页面滚动。
   */
  interactive?: boolean
  /**
   * 行程本按天分段（可选）：传入时忽略 routeGeometry 逐段画线；
   * coordinates 为 GeoJSON 顺序 [lng, lat]，dashed 段用虚线（估算段）。
   */
  legs?: RoutePreviewLeg[]
  /** marker 外观变体（可选）：key 为 point id；徽标文本覆盖与 active/muted/hollow 强调 */
  markerVariants?: Record<string, MarkerVariant>
  /** marker pointerdown（可选）：行程本把事件转发给 dnd-kit 代理做拖入某天 */
  onMarkerPointerDown?: (pointKey: string, event: PointerEvent) => void
  /** 右键 / 触屏长按 500ms（可选）：B2 自定义点创建入口 */
  onMapContextMenu?: (pos: { lat: number; lng: number; x: number; y: number }) => void
}

type MarkerEntry = RouteMarkerEntry

const MARKER_COLOR = '#e11d48'

export function RoutePreviewMap({
  points,
  routeGeometry,
  className = '',
  compact = false,
  activePointId = null,
  onPointSelect,
  renderPopup,
  onPopupClosed,
  popupControlsRef,
  interactive = true,
  legs,
  markerVariants,
  onMarkerPointerDown,
  onMapContextMenu,
}: RoutePreviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerEntriesRef = useRef<MarkerEntry[]>([])
  const pendingSyncRef = useRef<PendingSync | null>(null)
  const rebuildMarkersRef = useRef<((targetPoints: RoutePreviewPoint[]) => void) | null>(null)
  // M4：Popup 生命周期（同一时刻最多一个；marker 重建/切天/卸载时关闭）
  const popupLifecycleRef = useRef<PreviewPopupLifecycle | null>(null)
  const activePointIdRef = useRef<string | null>(activePointId)
  const onPointSelectRef = useRef(onPointSelect)
  const renderPopupRef = useRef(renderPopup)
  const onPopupClosedRef = useRef(onPopupClosed)
  const onMarkerPointerDownRef = useRef(onMarkerPointerDown)
  const onMapContextMenuRef = useRef(onMapContextMenu)
  const userInteractedRef = useRef(false)
  const signatureRef = useRef('')
  // WebGL 不可用等环境性失败：降级为占位，不冒泡卸载整个时间线
  const [mapUnavailable, setMapUnavailable] = useState(false)
  const initWarnedRef = useRef(false)

  // 缺省 id 回退（未接入联动的旧调用方），保证 marker/同步口径稳定
  const normalizedPoints = useMemo<RoutePreviewPoint[]>(
    () => points.map((point, index) => ({ ...point, id: point.id ?? `idx-${index}` })),
    [points],
  )

  const variantsSignature = useMemo(
    () =>
      markerVariants
        ? Object.entries(markerVariants)
            .map(([key, variant]) => `${key}:${variant.badge ?? ''}:${variant.emphasis}`)
            .sort()
            .join('|')
        : '',
    [markerVariants],
  )

  const latestStateRef = useRef({ points: normalizedPoints, routeGeometry, legs, markerVariants, variantsSignature, compact })
  latestStateRef.current = { points: normalizedPoints, routeGeometry, legs, markerVariants, variantsSignature, compact }
  activePointIdRef.current = activePointId
  onPointSelectRef.current = onPointSelect
  renderPopupRef.current = renderPopup
  onPopupClosedRef.current = onPopupClosed
  onMarkerPointerDownRef.current = onMarkerPointerDown
  onMapContextMenuRef.current = onMapContextMenu

  const computeSignature = (state: { points: RoutePreviewPoint[]; routeGeometry: typeof routeGeometry; legs: typeof legs; variantsSignature: string }) =>
    `${buildRenderSignature(state.points, state.routeGeometry, state.legs)}|v:${state.variantsSignature}`

  // M3：Popup 统一生命周期——closeButton + offset 14；内容优先 renderPopup 自定义
  // 元素（含「查看条目」按钮），缺省/返回 null 回退标题文本；同一时刻只保留一个
  const popupLifecycle = (popupLifecycleRef.current ??= createPreviewPopupLifecycle((id) =>
    onPopupClosedRef.current?.(id),
  ))

  // H3/L1：把关闭入口交给调用方，点位卡的「关闭」不再模拟点击 maplibre 的关闭按钮
  useEffect(() => {
    if (!popupControlsRef) return
    popupControlsRef.current = { close: () => popupLifecycleRef.current?.close() }
    return () => {
      popupControlsRef.current = null
    }
  }, [popupControlsRef])

  const closePopup = () => {
    popupLifecycle.close()
  }

  const openPopupFor = (point: RoutePreviewPoint) => {
    const map = mapRef.current
    if (!map) return
    // M11：Popup 内容升级为点位卡（含 16:10 封面图），默认 240px 会挤压卡片 → 放宽到 300px
    const popup = new maplibregl.Popup({ closeButton: true, offset: 14, maxWidth: '300px' }).setLngLat([point.lng, point.lat])
    const custom = renderPopupRef.current?.(point.id) ?? null
    if (custom) popup.setDOMContent(custom)
    else popup.setText(point.title ?? point.label)
    popup.addTo(map)
    popupLifecycle.open(popup, point.id)
    // H3：maplibre 自带关闭按钮/点击空白会绕过生命周期直接移除 Popup，订阅回来同步记录
    bindPopupClose(popupLifecycle, popup, point.id)
  }

  // 「在地图上看」Popup 补开：active 点在场而当前 Popup 未对齐时 openPopupFor。
  const syncActivePopup = () => {
    const activeId = activePointIdRef.current
    if (
      !needsActivePopupSync({
        activePointId: activeId,
        currentPopupPointId: popupLifecycle.currentPointId(),
        mapReady: Boolean(mapRef.current),
        markersReady: markerEntriesRef.current.length > 0,
        popupEnabled: Boolean(onPointSelectRef.current || renderPopupRef.current),
      })
    ) {
      return
    }
    const point = latestStateRef.current.points.find((candidate) => candidate.id === activeId)
    if (!point) return
    openPopupFor(point)
  }

  useEffect(() => {
    if (!containerRef.current) return

    // style provider 候选 + failover 状态：MapTiler 优先，OSM raster 兜底。
    const styleFailover = new RouteMapStyleFailover(getRouteMapStyleCandidates())
    const failoverTimeoutMs = getMapStyleFailoverTimeoutMs()
    let disposed = false
    let syncing = false
    let failoverTimer: number | null = null
    let failoverAttempt = 0

    // props 同步栅栏：style 未就绪时的 props 更新只留最新一次，就绪后补执行
    const pendingSync = createPendingSync()
    pendingSyncRef.current = pendingSync

    // Map 构造及紧随其后的同步初始化（手势禁用/addControl）在 WebGL 不可用时
    // 会同步抛出：catch 住降级为占位，提前返回、不注册任何监听，避免错误冒泡
    // 卸载整个聊天时间线
    let map: maplibregl.Map
    try {
      map = createRoutePreviewMap({
        container: containerRef.current,
        style: styleFailover.current.style,
        center: PREVIEW_DEFAULT_CENTER,
        interactive,
      })
    } catch (error) {
      if (!initWarnedRef.current) {
        initWarnedRef.current = true
        console.warn(`[RoutePreviewMap] 地图初始化失败（${isWebglContextError(error) ? 'WebGL 不可用' : '未知原因'}），降级为占位`, error)
      }
      pendingSyncRef.current = null
      setMapUnavailable(true)
      return
    }

    mapRef.current = map

    const onMarkerClick = (layout: MarkerLayout) => (event: MouseEvent) => {
      event.stopPropagation()
      // M3：marker 点选只通知（调用方设 activePointId）；Popup 直接在此打开，
      // 不依赖父组件 roundtrip；再次点击同一 marker 不重复开
      onPointSelectRef.current?.(layout.id)
      if (popupLifecycle.currentPointId() !== layout.id) openPopupFor(layout)
    }

    const rebuildMarkers = (targetPoints: RoutePreviewPoint[]) => {
      // M4：marker 重建/切天时先关闭 Popup（避免悬空 Popup 指向已移除的 marker）
      popupLifecycle.close()
      for (const entry of markerEntriesRef.current) entry.marker.remove()
      // L15：无 onPointSelect/renderPopup 的调用方（如路书页）marker 不可点、无 Popup
      const clickable = Boolean(onPointSelectRef.current || renderPopupRef.current)
      markerEntriesRef.current = rebuildRouteMarkers(map, targetPoints, {
        color: MARKER_COLOR,
        activeId: activePointIdRef.current,
        clickable,
        variants: latestStateRef.current.markerVariants,
        onClick: clickable ? onMarkerClick : undefined,
        onPointerDown: onMarkerPointerDownRef.current,
      })
    }
    rebuildMarkersRef.current = rebuildMarkers

    // 以 latestStateRef 中的最新 props 全量同步自定义资源（source/layer/marker/视野）。
    // 初次 load 与 provider failover setStyle 后的 styledata 都会走这里。
    const syncAllWithLatest = (options?: { forceFit?: boolean }) => {
      if (disposed || syncing) return
      syncing = true
      try {
        const latest = latestStateRef.current
        syncPreviewSources(map, buildPreviewData(latest.points, latest.routeGeometry, latest.legs))
        rebuildMarkers(latest.points)
        // rebuild 关 Popup 后补开 active 点（「在地图上看」先于地图 load 生效的场景）
        syncActivePopup()
        signatureRef.current = computeSignature(latest)
        if (options?.forceFit || !userInteractedRef.current) {
          fitMapToPreview(map, latest.points, latest.routeGeometry, latest.legs, latest.compact)
        }
      } finally {
        syncing = false
      }
    }

    const markInteracted = () => {
      userInteractedRef.current = true
    }

    map.on('dragstart', markInteracted)
    map.on('zoomstart', markInteracted)
    // 点击地图空白关闭 Popup
    map.on('click', closePopup)

    // 右键 / 触屏长按 500ms → onMapContextMenu（行程本自定义点入口，B2）
    const unbindContextMenu = bindMapContextMenu(map, () => onMapContextMenuRef.current, () => disposed)

    const clearFailoverTimer = () => {
      if (failoverTimer != null) {
        window.clearTimeout(failoverTimer)
        failoverTimer = null
      }
    }

    const armFailoverGuard = () => {
      clearFailoverTimer()
      failoverAttempt += 1
      const armedAttempt = failoverAttempt
      failoverTimer = window.setTimeout(() => {
        // 过期 timer 防护：attempt 已前进或组件已卸载时不动作
        if (disposed || failoverAttempt !== armedAttempt) return
        // style 长时间未成功加载（如 key 失效 style.json 403）→ 切下一个 provider
        switchToNextStyleProvider()
      }, failoverTimeoutMs)
    }

    const switchToNextStyleProvider = () => {
      const next = styleFailover.advance(Date.now())
      if (!next || disposed) return
      armFailoverGuard()
      // provider 切换属于故障恢复：重置交互标记，让重同步重新 fit 到路线视野
      userInteractedRef.current = false
      // 旧 style 的挂起更新作废，等新 style 就绪后补执行最新一次
      pendingSync.reset()
      map.setStyle(next.style)
    }

    const onStyleProviderError = (event: maplibregl.ErrorEvent) => {
      const msg = String((event as { error?: { message?: unknown } })?.error?.message || '')
      if (!styleFailover.shouldAdvanceOnError(msg, Date.now())) return
      switchToNextStyleProvider()
    }

    // setStyle 会移除全部自定义 source/layer。`style.load` 在 style JSON 就绪后触发
    // （setStyle 后同样触发），是 fallback 后重挂载的可靠事件；styledata 兜底。
    // 初次挂载的 style.load/styledata 早于监听器注册，初次同步仍由 load 事件（强制 fit）负责。
    const maybeResyncAfterStyleEvent = (event: RouteStyleResyncEvent, options?: { forceFit?: boolean }) => {
      if (
        !shouldResyncRoutePreviewOnStyleEvent({
          event,
          styleLoaded: map.isStyleLoaded() === true,
          layersPresent: Boolean(map.getLayer('route-preview-route-line')),
          syncing,
          disposed,
        })
      ) {
        return
      }
      clearFailoverTimer()
      syncAllWithLatest(options)
    }

    const onStyleLoad = () => {
      maybeResyncAfterStyleEvent('style.load')
      pendingSync.markReady()
    }
    const onStyleData = () => maybeResyncAfterStyleEvent('styledata')
    const onMapLoad = () => {
      maybeResyncAfterStyleEvent('load', { forceFit: true })
      pendingSync.markReady()
    }
    const onMapIdle = () => {
      if (disposed) return
      // style 成功加载并渲染后解除超时守卫（error 监听保持，覆盖 key 中途被撤销的场景）
      if (map.isStyleLoaded()) {
        clearFailoverTimer()
        pendingSync.markReady()
      }
    }

    map.on('error', onStyleProviderError)
    map.on('idle', onMapIdle)
    map.on('style.load', onStyleLoad)
    map.on('styledata', onStyleData)
    map.on('load', onMapLoad)

    armFailoverGuard()

    return () => {
      disposed = true
      clearFailoverTimer()
      unbindContextMenu()
      map.off('error', onStyleProviderError)
      map.off('idle', onMapIdle)
      map.off('style.load', onStyleLoad)
      map.off('styledata', onStyleData)
      map.off('load', onMapLoad)
      closePopup()
      markerEntriesRef.current.forEach((entry) => entry.marker.remove())
      markerEntriesRef.current = []
      map.remove()
      mapRef.current = null
      pendingSyncRef.current = null
      rebuildMarkersRef.current = null
    }
  }, [interactive])

  // props 同步：不再因 isStyleLoaded() 早退丢弃更新——style 未就绪时挂起
  // 最新一次，load/style.load/idle 任一就绪信号补执行（修切天 marker 与路线错配）
  useEffect(() => {
    const pendingSync = pendingSyncRef.current
    if (!pendingSync) return
    pendingSync.request(() => {
      const map = mapRef.current
      if (!map) return

      const nextSignature = computeSignature(latestStateRef.current)
      const routeChanged = signatureRef.current !== nextSignature
      if (routeChanged) {
        signatureRef.current = nextSignature
        userInteractedRef.current = false
      }

      const latest = latestStateRef.current
      syncPreviewSources(map, buildPreviewData(latest.points, latest.routeGeometry, latest.legs))
      rebuildMarkersRef.current?.(latest.points)
      // rebuild 关 Popup 后补开 active 点（挂起的 props 同步补执行时同样兜底）
      syncActivePopup()

      if (!userInteractedRef.current) {
        fitMapToPreview(map, latest.points, latest.routeGeometry, latest.legs, latest.compact)
      }
    })
  }, [normalizedPoints, routeGeometry, legs, markerVariants, variantsSignature, compact])

  // activePointId 变化：只切 marker 高亮（不重建）；不在视口内时 easeTo 并补开 Popup。
  // 地图未 ready 时 Popup 部分由 markersReady 判定跳过，marker 就绪后由 rebuild 兜底。
  useEffect(() => {
    for (const entry of markerEntriesRef.current) {
      applyMarkerActive(entry.el, entry.id === activePointId)
    }
    if (!activePointId) return
    const map = mapRef.current
    if (!map) return
    const point = normalizedPoints.find((candidate) => candidate.id === activePointId)
    if (!point) return
    try {
      const bounds = map.getBounds()
      if (!bounds || !bounds.contains([point.lng, point.lat])) {
        map.easeTo({ center: [point.lng, point.lat], duration: 300 })
      }
    } catch {
      // style 未就绪等瞬时状态：跳过一次居中不影响高亮
    }
    syncActivePopup()
  }, [activePointId, normalizedPoints])

  const previewData = buildPreviewData(normalizedPoints, routeGeometry, legs)
  const hasWideSpread = (() => {
    if (normalizedPoints.length < 2) return false
    let maxLegDistance = 0
    for (let index = 0; index < normalizedPoints.length - 1; index += 1) {
      maxLegDistance = Math.max(maxLegDistance, distanceMeters([normalizedPoints[index]!.lng, normalizedPoints[index]!.lat], [normalizedPoints[index + 1]!.lng, normalizedPoints[index + 1]!.lat]))
    }
    return maxLegDistance >= ROUTE_SPREAD_HINT_METERS
  })()

  const hint = previewData.hasFallback
    ? previewData.hasLongJump
      ? '路线跨度较大，当前为分段示意线，请缩放查看各段。'
      : '暂未拿到真实道路路线，当前为站点直连示意。'
    : hasWideSpread
      ? '路线跨度较大，可缩放查看各段细节。'
      : null

  if (mapUnavailable) {
    // 占位与正常渲染保持同一容器结构/尺寸契约（className 原样透传）
    return (
      <div className={`relative h-full w-full ${className}`}>
        <MapUnavailablePlaceholder className="h-full w-full" points={normalizedPoints} />
      </div>
    )
  }

  if (points.length === 0) {
    return (
      <div className={`bg-gray-100 flex items-center justify-center text-gray-400 ${className}`}>
        No points to display
      </div>
    )
  }

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div ref={containerRef} className="h-full w-full bg-gray-100" />
      {hint ? (
        <div className="pointer-events-none absolute bottom-4 right-4 max-w-[16rem] rounded-2xl border border-white/60 bg-white/92 px-3 py-2 text-[11px] font-medium leading-5 text-slate-600 shadow-[0_18px_28px_-22px_rgba(15,23,42,0.48)] backdrop-blur-sm">
          {hint}
        </div>
      ) : null}
    </div>
  )
}
