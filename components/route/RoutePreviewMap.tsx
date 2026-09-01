'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  getMapStyleFailoverTimeoutMs,
  getRouteMapStyleCandidates,
  RouteMapStyleFailover,
  shouldResyncRoutePreviewOnStyleEvent,
  type RouteStyleResyncEvent,
} from './mapStyleFailover'

type PreviewLineKind = 'route' | 'schematic' | 'jump'

export interface RoutePreviewMapProps {
  points: Array<{ lat: number; lng: number; label: string }>
  routeGeometry: { type: 'LineString'; coordinates: [number, number][] } | null
  className?: string
  compact?: boolean
  /**
   * 手势交互开关（mount 时生效）。默认 true 保持既有全交互行为；
   * false 用于 inline 嵌入可滚动页面的场景：禁用单指拖拽/滚轮缩放/双击缩放，
   * 保留移动端双指缩放旋转（touchZoomRotate），避免劫持页面滚动。
   */
  interactive?: boolean
}

type MarkerLayout = {
  lat: number
  lng: number
  label: string
  offsetX: number
  offsetY: number
  overlapCount: number
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

const DEFAULT_CENTER: [number, number] = [139.767125, 35.681236]
const LINE_SOURCE_ID = 'route-preview-lines'
const LABEL_SOURCE_ID = 'route-preview-labels'
const ROUTE_LAYER_ID = 'route-preview-route-line'
const SCHEMATIC_LAYER_ID = 'route-preview-schematic-line'
const JUMP_LAYER_ID = 'route-preview-jump-line'
const JUMP_LABEL_LAYER_ID = 'route-preview-jump-label'
const ROUTE_SPREAD_HINT_METERS = 120_000
const ROUTE_LONG_JUMP_METERS = 80_000
const OVERLAP_THRESHOLD_METERS = 45
const OVERLAP_OFFSET_PX = 18

function toLngLat(point: { lat: number; lng: number }): [number, number] {
  return [point.lng, point.lat]
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const earthRadius = 6_371_000
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const haversine =
    sinLat * sinLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng

  return 2 * earthRadius * Math.asin(Math.sqrt(haversine))
}

function buildMarkerLayouts(points: RoutePreviewMapProps['points']): MarkerLayout[] {
  const groups: number[][] = []

  for (let index = 0; index < points.length; index += 1) {
    const coord = toLngLat(points[index]!)
    let targetGroup = -1

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex]!
      if (group.some((memberIndex) => distanceMeters(coord, toLngLat(points[memberIndex]!)) <= OVERLAP_THRESHOLD_METERS)) {
        targetGroup = groupIndex
        break
      }
    }

    if (targetGroup >= 0) groups[targetGroup]!.push(index)
    else groups.push([index])
  }

  const layouts = new Map<number, MarkerLayout>()
  for (const group of groups) {
    const groupSize = group.length
    group.forEach((pointIndex, orderIndex) => {
      const point = points[pointIndex]!
      let offsetX = 0
      let offsetY = 0

      if (groupSize > 1) {
        const radius = OVERLAP_OFFSET_PX + Math.max(0, groupSize - 2) * 2
        const angle = -Math.PI / 2 + (orderIndex * 2 * Math.PI) / groupSize
        offsetX = Math.round(Math.cos(angle) * radius)
        offsetY = Math.round(Math.sin(angle) * radius)
      }

      layouts.set(pointIndex, {
        ...point,
        offsetX,
        offsetY,
        overlapCount: groupSize,
      })
    })
  }

  return points.map((_, index) => layouts.get(index)!)
}

function buildPreviewData(
  points: RoutePreviewMapProps['points'],
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
  points: RoutePreviewMapProps['points'],
  routeGeometry: RoutePreviewMapProps['routeGeometry'],
): string {
  const pointsSignature = points.map((point) => `${point.label}:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join('|')
  if (!routeGeometry?.coordinates.length) return `${pointsSignature}|nogeometry`
  const first = routeGeometry.coordinates[0]!
  const last = routeGeometry.coordinates[routeGeometry.coordinates.length - 1]!
  return `${pointsSignature}|geometry:${routeGeometry.coordinates.length}:${first.join(',')}:${last.join(',')}`
}

function buildBounds(points: RoutePreviewMapProps['points'], routeGeometry: RoutePreviewMapProps['routeGeometry']) {
  const coords = routeGeometry?.coordinates.length
    ? [...routeGeometry.coordinates, ...points.map(toLngLat)]
    : points.map(toLngLat)
  if (!coords.length) return null
  const bounds = new maplibregl.LngLatBounds(coords[0], coords[0])
  for (const coord of coords.slice(1)) bounds.extend(coord)
  return bounds
}

function fitMap(map: maplibregl.Map, points: RoutePreviewMapProps['points'], routeGeometry: RoutePreviewMapProps['routeGeometry'], compact: boolean) {
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

function createNumberedMarker(layout: MarkerLayout, color: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'flex items-center justify-center rounded-full bg-white font-bold shadow-sm'
  el.style.width = layout.overlapCount > 1 ? '28px' : '24px'
  el.style.height = layout.overlapCount > 1 ? '28px' : '24px'
  el.style.border = `2px solid ${color}`
  el.style.color = color
  el.style.fontSize = '12px'
  el.style.transform = `translate(${layout.offsetX}px, ${layout.offsetY}px)`
  el.style.boxShadow = layout.overlapCount > 1 ? '0 6px 18px rgba(15,23,42,0.16)' : '0 4px 12px rgba(15,23,42,0.12)'
  el.title = layout.overlapCount > 1 ? `${layout.label}（与 ${layout.overlapCount - 1} 个点位接近）` : layout.label
  el.innerText = layout.label
  return el
}

export function RoutePreviewMap({ points, routeGeometry, className = '', compact = false, interactive = true }: RoutePreviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const latestStateRef = useRef({ points, routeGeometry, compact })
  const userInteractedRef = useRef(false)
  const signatureRef = useRef('')

  latestStateRef.current = { points, routeGeometry, compact }

  useEffect(() => {
    if (!containerRef.current) return

    // style provider 候选 + failover 状态：MapTiler 优先，OSM raster 兜底。
    const styleFailover = new RouteMapStyleFailover(getRouteMapStyleCandidates())
    const failoverTimeoutMs = getMapStyleFailoverTimeoutMs()
    let disposed = false
    let syncing = false
    let failoverTimer: number | null = null
    let failoverAttempt = 0

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFailover.current.style,
      center: DEFAULT_CENTER,
      zoom: 5,
      interactive: true,
      attributionControl: false,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
    })

    // inline 嵌入态：禁用会劫持页面滚动的手势（单指拖拽/滚轮/双击/键盘），
    // 保留移动端双指缩放旋转（touchZoomRotate）。interactive 为 mount 时常量。
    if (!interactive) {
      map.dragPan.disable()
      map.scrollZoom.disable()
      map.boxZoom.disable()
      map.doubleClickZoom.disable()
      map.keyboard.disable()
    }

    mapRef.current = map
    if (interactive) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right')
    }

    const markInteracted = () => {
      userInteractedRef.current = true
    }

    map.on('dragstart', markInteracted)
    map.on('zoomstart', markInteracted)

    const rebuildMarkers = (targetPoints: RoutePreviewMapProps['points']) => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      const layouts = buildMarkerLayouts(targetPoints)
      layouts.forEach((layout) => {
        const el = createNumberedMarker(layout, '#e11d48')
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([layout.lng, layout.lat])
          .addTo(map)
        markersRef.current.push(marker)
      })
    }

    // 以 latestStateRef 中的最新 props 全量同步自定义资源（source/layer/marker/视野）。
    // 初次 load 与 provider failover setStyle 后的 styledata 都会走这里。
    const syncAllWithLatest = (options?: { forceFit?: boolean }) => {
      if (disposed || syncing) return
      syncing = true
      try {
        const { points: latestPoints, routeGeometry: latestGeometry, compact: latestCompact } = latestStateRef.current
        syncPreviewSources(map, buildPreviewData(latestPoints, latestGeometry))
        rebuildMarkers(latestPoints)
        signatureRef.current = buildRenderSignature(latestPoints, latestGeometry)
        if (options?.forceFit || !userInteractedRef.current) {
          fitMap(map, latestPoints, latestGeometry, latestCompact)
        }
      } finally {
        syncing = false
      }
    }

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
      map.setStyle(next.style)
    }

    const onStyleProviderError = (event: maplibregl.ErrorEvent) => {
      const msg = String((event as { error?: { message?: unknown } })?.error?.message || '')
      if (!styleFailover.shouldAdvanceOnError(msg, Date.now())) return
      switchToNextStyleProvider()
    }

    const onMapIdle = () => {
      if (disposed) return
      // style 成功加载并渲染后解除超时守卫（error 监听保持，覆盖 key 中途被撤销的场景）
      if (map.isStyleLoaded()) clearFailoverTimer()
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

    const onStyleLoad = () => maybeResyncAfterStyleEvent('style.load')
    const onStyleData = () => maybeResyncAfterStyleEvent('styledata')
    const onMapLoad = () => maybeResyncAfterStyleEvent('load', { forceFit: true })

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
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const nextSignature = buildRenderSignature(points, routeGeometry)
    const routeChanged = signatureRef.current !== nextSignature
    if (routeChanged) {
      signatureRef.current = nextSignature
      userInteractedRef.current = false
    }

    syncPreviewSources(map, buildPreviewData(points, routeGeometry))

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const layouts = buildMarkerLayouts(points)
    layouts.forEach((layout) => {
      const el = createNumberedMarker(layout, '#e11d48')
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([layout.lng, layout.lat])
        .addTo(map)
      markersRef.current.push(marker)
    })

    if (!userInteractedRef.current) {
      fitMap(map, points, routeGeometry, compact)
    }
  }, [points, routeGeometry, compact])

  const previewData = buildPreviewData(points, routeGeometry)
  const hasWideSpread = (() => {
    if (points.length < 2) return false
    let maxLegDistance = 0
    for (let index = 0; index < points.length - 1; index += 1) {
      maxLegDistance = Math.max(maxLegDistance, distanceMeters(toLngLat(points[index]!), toLngLat(points[index + 1]!)))
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
