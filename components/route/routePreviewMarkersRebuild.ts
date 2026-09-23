/**
 * RoutePreviewMap 的 marker 全量重建：按 targetPoints 逐点创建序号 marker。
 * 独立成文件以保持 routePreviewMarkers.ts 可被 jsdom 测试直引（无 maplibre 运行时依赖）。
 */
import maplibregl from 'maplibre-gl'
import {
  buildMarkerLayouts,
  createNumberedMarker,
  markerOptionsFor,
  type MarkerLayout,
  type MarkerVariant,
  type RoutePreviewPoint,
} from './routePreviewMarkers'

export type RouteMarkerEntry = { id: string; marker: maplibregl.Marker; el: HTMLDivElement }

export function rebuildRouteMarkers(
  map: maplibregl.Map,
  targetPoints: RoutePreviewPoint[],
  options: {
    color: string
    activeId: string | null
    clickable: boolean
    variants?: Record<string, MarkerVariant>
    /** B3：可选封面缩略图（key 为 point id）；未传或值为 null 时保持序号/icon 样式 */
    images?: Record<string, string | null>
    onClick?: (layout: MarkerLayout) => (event: MouseEvent) => void
    onPointerDown?: (pointKey: string, event: PointerEvent) => void
  },
): RouteMarkerEntry[] {
  const layouts = buildMarkerLayouts(targetPoints)
  const entries: RouteMarkerEntry[] = []
  layouts.forEach((layout) => {
    const el = createNumberedMarker(layout, {
      color: options.color,
      active: layout.id === options.activeId,
      clickable: options.clickable,
      variant: options.variants?.[layout.id],
      image: options.images?.[layout.id] ?? null,
    })
    if (options.clickable && options.onClick) el.addEventListener('click', options.onClick(layout))
    if (options.onPointerDown) {
      const callback = options.onPointerDown
      el.addEventListener('pointerdown', (event) => callback(layout.id, event))
    }
    const marker = new maplibregl.Marker({ element: el, ...markerOptionsFor(layout) })
      .setLngLat([layout.lng, layout.lat])
      .addTo(map)
    entries.push({ id: layout.id, marker, el })
  })
  return entries
}
