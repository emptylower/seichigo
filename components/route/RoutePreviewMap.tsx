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
  buildMarkerLayouts,
  createNumberedMarker,
  markerOptionsFor,
  distanceMeters,
  type MarkerLayout,
  type RoutePreviewPoint,
} from './routePreviewMarkers'

type PreviewLineKind = 'route' | 'schematic' | 'jump'

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
}

type PreviewLineProperties = {
  kind: PreviewLineKind
}

type PreviewLabelProperties = {
  label: string
}

type PreviewData = {
  lineCollection: GeoJSON.FeatureCollection<GeoJSON.LineString, PreviewLineProperties>
  labelCollection: GeoJSON.FeatureCollection<GeoJSON.Point, PreviewLabelProperties>
  hasFallback: boolean
  hasLongJump: boolean
}

type MarkerEntry = { id: string; marker: maplibregl.Marker; el: HTMLDivElement }

const DEFAULT_CENTER: [number, number] = [139.767125, 35.681236]
const LINE_SOURCE_ID = 'route-preview-lines'
const LABEL_SOURCE_ID = 'route-preview-labels'
const ROUTE_LAYER_ID = 'route-preview-route-line'
const SCHEMATIC_LAYER_ID = 'route-preview-schematic-line'
const JUMP_LAYER_ID = 'route-preview-jump-line'
const JUMP_LABEL_LAYER_ID = 'route-preview-jump-label'
const ROUTE_SPREAD_HINT_METERS = 120_000
const ROUTE_LONG_JUMP_METERS = 80_000
const MARKER_COLOR = '#e11d48'

function toLngLat(point: { lat: number; lng: number }): [number, number] {
  return [point.lng, point.lat]
}

function buildPreviewData(
  points: RoutePreviewPoint[],
  routeGeometry: RoutePreviewMapProps['routeGeometry'],
): PreviewData {
  if (routeGeometry && routeGeometry.coordinates.length >= 2) {
    return {
      lineCollection: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { kind: 'route' },
            geometry: routeGeometry,
          },
        ],
      },
      labelCollection: { type: 'FeatureCollection', features: [] },
      hasFallback: false,
      hasLongJump: false,
    }
  }

  const lineFeatures: Array<GeoJSON.Feature<GeoJSON.LineString, PreviewLineProperties>> = []
  const labelFeatures: Array<GeoJSON.Feature<GeoJSON.Point, PreviewLabelProperties>> = []
  let hasLongJump = false

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!
    const end = points[index + 1]!
    const startCoord = toLngLat(start)
    const endCoord = toLngLat(end)
    const longJump = distanceMeters(startCoord, endCoord) >= ROUTE_LONG_JUMP_METERS
    hasLongJump ||= longJump

    lineFeatures.push({
      type: 'Feature',
      properties: { kind: longJump ? 'jump' : 'schematic' },
      geometry: {
        type: 'LineString',
        coordinates: [startCoord, endCoord],
      },
    })

    if (longJump) {
      labelFeatures.push({
        type: 'Feature',
        properties: { label: `${start.label}→${end.label}` },
        geometry: {
          type: 'Point',
          coordinates: [
            (startCoord[0] + endCoord[0]) / 2,
            (startCoord[1] + endCoord[1]) / 2,
          ],
        },
      })
    }
  }

  return {
    lineCollection: { type: 'FeatureCollection', features: lineFeatures },
    labelCollection: { type: 'FeatureCollection', features: labelFeatures },
    hasFallback: lineFeatures.length > 0,
    hasLongJump,
  }
}

function buildRenderSignature(
  points: RoutePreviewPoint[],
  routeGeometry: RoutePreviewMapProps['routeGeometry'],
): string {
  const pointsSignature = points.map((point) => `${point.id}:${point.label}:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join('|')
  if (!routeGeometry?.coordinates.length) return `${pointsSignature}|nogeometry`
  const first = routeGeometry.coordinates[0]!
  const last = routeGeometry.coordinates[routeGeometry.coordinates.length - 1]!
  return `${pointsSignature}|geometry:${routeGeometry.coordinates.length}:${first.join(',')}:${last.join(',')}`
}

function buildBounds(points: RoutePreviewPoint[], routeGeometry: RoutePreviewMapProps['routeGeometry']) {
  const coords = routeGeometry?.coordinates.length
    ? [...routeGeometry.coordinates, ...points.map(toLngLat)]
    : points.map(toLngLat)
  if (!coords.length) return null
  const bounds = new maplibregl.LngLatBounds(coords[0], coords[0])
  for (const coord of coords.slice(1)) bounds.extend(coord)
  return bounds
}

function fitMap(map: maplibregl.Map, points: RoutePreviewPoint[], routeGeometry: RoutePreviewMapProps['routeGeometry'], compact: boolean) {
  const bounds = buildBounds(points, routeGeometry)
  if (!bounds) {
    map.jumpTo({ center: DEFAULT_CENTER, zoom: 5 })
    return
  }

  map.fitBounds(bounds, {
    padding: compact ? 24 : 48,
    duration: 0,
    maxZoom: 14,
  })
}

function syncPreviewSources(map: maplibregl.Map, previewData: PreviewData) {
  const lineSource = map.getSource(LINE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (lineSource) lineSource.setData(previewData.lineCollection)
  else {
    map.addSource(LINE_SOURCE_ID, {
      type: 'geojson',
      data: previewData.lineCollection,
    })
  }

  const labelSource = map.getSource(LABEL_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (labelSource) labelSource.setData(previewData.labelCollection)
  else {
    map.addSource(LABEL_SOURCE_ID, {
      type: 'geojson',
      data: previewData.labelCollection,
    })
  }

  if (!map.getLayer(ROUTE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: LINE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'route'],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#e11d48',
        'line-width': 4,
      },
    })
  }

  if (!map.getLayer(SCHEMATIC_LAYER_ID)) {
    map.addLayer({
      id: SCHEMATIC_LAYER_ID,
      type: 'line',
      source: LINE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'schematic'],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#e11d48',
        'line-width': 3,
        'line-opacity': 0.48,
        'line-dasharray': [2, 2],
      },
    })
  }

  if (!map.getLayer(JUMP_LAYER_ID)) {
    map.addLayer({
      id: JUMP_LAYER_ID,
      type: 'line',
      source: LINE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'jump'],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#fb7185',
        'line-width': 3,
        'line-opacity': 0.78,
        'line-dasharray': [1, 2.2],
      },
    })
  }

  if (!map.getLayer(JUMP_LABEL_LAYER_ID)) {
    map.addLayer({
      id: JUMP_LABEL_LAYER_ID,
      type: 'symbol',
      source: LABEL_SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#be123c',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    })
  }
}

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

  const latestStateRef = useRef({ points: normalizedPoints, routeGeometry, compact })
  latestStateRef.current = { points: normalizedPoints, routeGeometry, compact }
  activePointIdRef.current = activePointId
  onPointSelectRef.current = onPointSelect
  renderPopupRef.current = renderPopup
  onPopupClosedRef.current = onPopupClosed

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
  // 地图/marker 未就绪（DayMap 刚挂载、地图未 load）时不动——那时开的 Popup 会被
  // rebuildMarkers 关掉；就绪后的补开由 rebuild 完成路径（syncAllWithLatest /
  // props 同步 effect）调用本函数兜底。
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
      map = new maplibregl.Map({
        container: containerRef.current,
        style: styleFailover.current.style,
        center: DEFAULT_CENTER,
        zoom: 5,
        interactive: true,
        attributionControl: false,
        dragRotate: false,
        touchPitch: false,
        pitchWithRotate: false,
        // inline 嵌入态：协作手势防滚动劫持（Ctrl/⌘+滚轮缩放，单指拖动归页面）；
        // 全交互态（展开）不传，保持原生手势
        ...(interactive
          ? {}
          : {
              cooperativeGestures: true,
              locale: {
                'CooperativeGesturesHandler.WindowsHelpText': '按住 Ctrl 并滚动可缩放地图',
                'CooperativeGesturesHandler.MacHelpText': '按住 ⌘ 并滚动可缩放地图',
                'CooperativeGesturesHandler.MobileHelpText': '双指操作地图',
              },
            }),
      })

      // inline 态仍禁用与页面/缩放冲突的手势；dragPan/scrollZoom 由协作手势接管
      if (!interactive) {
        map.boxZoom.disable()
        map.doubleClickZoom.disable()
        map.keyboard.disable()
      }

      // 两种模式都给 ± 缩放按钮：PC inline 态无需按键即可缩放
      map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right')
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
      markerEntriesRef.current = []
      // L15：无 onPointSelect/renderPopup 的调用方（如路书页）marker 不可点、无 Popup
      const clickable = Boolean(onPointSelectRef.current || renderPopupRef.current)
      const layouts = buildMarkerLayouts(targetPoints)
      layouts.forEach((layout) => {
        const el = createNumberedMarker(layout, {
          color: MARKER_COLOR,
          active: layout.id === activePointIdRef.current,
          clickable,
        })
        if (clickable) el.addEventListener('click', onMarkerClick(layout))
        const marker = new maplibregl.Marker({ element: el, ...markerOptionsFor(layout) })
          .setLngLat([layout.lng, layout.lat])
          .addTo(map)
        markerEntriesRef.current.push({ id: layout.id, marker, el })
      })
    }
    rebuildMarkersRef.current = rebuildMarkers

    // 以 latestStateRef 中的最新 props 全量同步自定义资源（source/layer/marker/视野）。
    // 初次 load 与 provider failover setStyle 后的 styledata 都会走这里。
    const syncAllWithLatest = (options?: { forceFit?: boolean }) => {
      if (disposed || syncing) return
      syncing = true
      try {
        const { points: latestPoints, routeGeometry: latestGeometry, compact: latestCompact } = latestStateRef.current
        syncPreviewSources(map, buildPreviewData(latestPoints, latestGeometry))
        rebuildMarkers(latestPoints)
        // rebuild 关 Popup 后补开 active 点（「在地图上看」先于地图 load 生效的场景）
        syncActivePopup()
        signatureRef.current = buildRenderSignature(latestPoints, latestGeometry)
        if (options?.forceFit || !userInteractedRef.current) {
          fitMap(map, latestPoints, latestGeometry, latestCompact)
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

    // setStyle 会移除全部自定义 source/layer。
    // `style.load` 在每次 style JSON 就绪后触发（setStyle 后同样触发；此时 isStyleLoaded() 可能
    // 仍为 false，不能作为前置条件），是 fallback 后重挂载的可靠事件；styledata 作为兜底。
    // 初次挂载：inline style 的 style.load/styledata 在 Map 构造器内同步触发、早于监听器注册，
    // 因此初次同步仍由 load 事件（强制 fit）负责。
    const maybeResyncAfterStyleEvent = (event: RouteStyleResyncEvent, options?: { forceFit?: boolean }) => {
      if (
        !shouldResyncRoutePreviewOnStyleEvent({
          event,
          styleLoaded: map.isStyleLoaded() === true,
          layersPresent: Boolean(map.getLayer(ROUTE_LAYER_ID)),
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

      const nextSignature = buildRenderSignature(normalizedPoints, routeGeometry)
      const routeChanged = signatureRef.current !== nextSignature
      if (routeChanged) {
        signatureRef.current = nextSignature
        userInteractedRef.current = false
      }

      syncPreviewSources(map, buildPreviewData(normalizedPoints, routeGeometry))
      rebuildMarkersRef.current?.(normalizedPoints)
      // rebuild 关 Popup 后补开 active 点（挂起的 props 同步补执行时同样兜底）
      syncActivePopup()

      if (!userInteractedRef.current) {
        fitMap(map, normalizedPoints, routeGeometry, compact)
      }
    })
  }, [normalizedPoints, routeGeometry, compact])

  // activePointId 变化：只切换 marker 高亮（不重建）；该点不在视口内时 easeTo；
  // M3：条目侧「在地图上看」后自动打开该点 Popup。地图未 ready 时 effect 的
  // Popup 部分直接返回（markersReady 判定在 syncActivePopup 内），marker 就绪
  // 由 rebuild 完成后的 syncActivePopup 兜底——修复 DayMap 刚挂载时 effect 先于
  // 地图 load 运行、Popup 先开又被 rebuildMarkers 关掉不再打开的问题
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

  const previewData = buildPreviewData(normalizedPoints, routeGeometry)
  const hasWideSpread = (() => {
    if (normalizedPoints.length < 2) return false
    let maxLegDistance = 0
    for (let index = 0; index < normalizedPoints.length - 1; index += 1) {
      maxLegDistance = Math.max(maxLegDistance, distanceMeters(toLngLat(normalizedPoints[index]!), toLngLat(normalizedPoints[index + 1]!)))
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
