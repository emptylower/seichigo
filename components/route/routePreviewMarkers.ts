/**
 * RoutePreviewMap 的序号 marker：布局（重叠散开）与 DOM 创建/高亮。
 * marker 元素携带 data-point-id（与列表条目同值），支持点击与 active 态
 * （放大 1.25、主色填充白字、z-index 提升）——active 切换只改 class/内联
 * 样式，不重建 marker。
 *
 * R1 关键约束：maplibre 用 marker **根元素**的 style.transform 做定位，任何
 * 对根元素 transform 的写入都会把 marker 打回地图原点。因此：
 * - 根元素只做定位宿主（不写 transform / left / top），重叠错位交给
 *   `new maplibregl.Marker({ element, offset })`（见 markerOptionsFor）；
 * - 视觉圆片放在内层 span，高亮缩放/配色只作用于内层。
 */

export type RoutePreviewPoint = { id: string; lat: number; lng: number; label: string; title?: string }

export type MarkerLayout = RoutePreviewPoint & {
  offsetX: number
  offsetY: number
  overlapCount: number
}

export const MARKER_ACTIVE_CLASS = 'route-preview-marker--active'
export const MARKER_INNER_CLASS = 'route-preview-marker__inner'

const OVERLAP_THRESHOLD_METERS = 45
const OVERLAP_OFFSET_PX = 18

export function distanceMeters(a: [number, number], b: [number, number]): number {
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

export function buildMarkerLayouts(points: RoutePreviewPoint[]): MarkerLayout[] {
  const groups: number[][] = []

  for (let index = 0; index < points.length; index += 1) {
    const coord: [number, number] = [points[index]!.lng, points[index]!.lat]
    let targetGroup = -1

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex]!
      if (group.some((memberIndex) => distanceMeters(coord, [points[memberIndex]!.lng, points[memberIndex]!.lat]) <= OVERLAP_THRESHOLD_METERS)) {
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

/** maplibre Marker 构造参数：重叠错位用 offset 传给 maplibre，绝不自写 transform */
export function markerOptionsFor(layout: MarkerLayout): { offset: [number, number] } {
  return { offset: [layout.offsetX, layout.offsetY] }
}

/** marker 视觉圆片（内层 span）；缺失时退回根元素，保证旧调用不炸 */
export function markerInnerElement(el: HTMLElement): HTMLElement {
  return (el.querySelector(`.${MARKER_INNER_CLASS}`) as HTMLElement | null) ?? el
}

/** active 切换：只动 class、内层 transform/配色与根元素 z-index（marker 不重建、根 transform 不碰） */
export function applyMarkerActive(el: HTMLElement, active: boolean): void {
  const color = el.dataset.markerColor ?? '#e11d48'
  el.classList.toggle(MARKER_ACTIVE_CLASS, active)
  el.dataset.active = active ? 'true' : 'false'
  el.style.zIndex = active ? '3' : '1'
  const inner = markerInnerElement(el)
  inner.style.transform = active ? 'scale(1.25)' : ''
  inner.style.backgroundColor = active ? color : '#ffffff'
  inner.style.color = active ? '#ffffff' : color
}

export function createNumberedMarker(
  layout: MarkerLayout,
  options: { color: string; active?: boolean; clickable?: boolean },
): HTMLDivElement {
  const size = layout.overlapCount > 1 ? '28px' : '24px'
  const el = document.createElement('div')
  el.className = 'route-preview-marker'
  el.dataset.pointId = layout.id
  el.dataset.offsetX = String(layout.offsetX)
  el.dataset.offsetY = String(layout.offsetY)
  el.dataset.markerColor = options.color
  el.style.width = size
  el.style.height = size
  // L15：无点选回调的场景（如路书页）marker 不可点——不给 pointer 游标、不挂 click
  if (options.clickable !== false) el.style.cursor = 'pointer'
  const name = layout.title ?? layout.label
  el.title = layout.overlapCount > 1 ? `${name}（与 ${layout.overlapCount - 1} 个点位接近）` : name

  const inner = document.createElement('span')
  inner.className = `${MARKER_INNER_CLASS} flex items-center justify-center rounded-full font-bold`
  inner.style.width = '100%'
  inner.style.height = '100%'
  inner.style.border = `2px solid ${options.color}`
  inner.style.fontSize = '12px'
  inner.style.boxShadow = layout.overlapCount > 1 ? '0 6px 18px rgba(15,23,42,0.16)' : '0 4px 12px rgba(15,23,42,0.12)'
  inner.textContent = layout.label
  el.appendChild(inner)

  applyMarkerActive(el, options.active ?? false)
  return el
}
