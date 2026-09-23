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
 *
 * B3：可选缩略图（image）——有图时内层换成 44px 圆形封面 + 右下角序号徽标，
 * 加载失败回退为序号圆点；自定义点（placeKind 非空且无图）按 kind 渲染 lucide
 * 图标圆点（底色 #0f172a），不放图。
 */

export type RoutePreviewPoint = { id: string; lat: number; lng: number; label: string; title?: string }

/**
 * marker 外观变体（行程本按天）：badge 覆盖序号文本；
 * emphasis = active 默认 / muted 半透 / hollow 虚线空心（未安排）；
 * placeKind 仅在自定义点（无预览图）上生效，用于挑选 lucide 图标。
 */
export type MarkerVariant = {
  badge?: string
  emphasis: 'active' | 'muted' | 'hollow'
  placeKind?: 'lodging' | 'station' | 'restaurant' | 'other' | null
}

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

/** lucide 图标（bed / utensils / train / map-pin）的内联 SVG，stroke=currentColor */
const PLACE_KIND_ICON_SVG: Record<'lodging' | 'station' | 'restaurant' | 'other', string> = {
  lodging:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>',
  restaurant:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
  station:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/><path d="M8 15h.01"/><path d="M16 15h.01"/></svg>',
  other:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
}

/** active 切换：只动 class、内层 transform/配色与根元素 z-index（marker 不重建、根 transform 不碰） */
export function applyMarkerActive(el: HTMLElement, active: boolean): void {
  const color = el.dataset.markerColor ?? '#e11d48'
  el.classList.toggle(MARKER_ACTIVE_CLASS, active)
  el.dataset.active = active ? 'true' : 'false'
  el.style.zIndex = active ? '3' : '1'
  const inner = markerInnerElement(el)
  const markerKind = el.dataset.markerKind ?? 'number'
  if (markerKind === 'image') {
    // 缩略图：只换描边色 + 缩放，不覆盖背景图
    inner.style.transform = active ? 'scale(1.27)' : ''
    inner.style.borderColor = active ? color : '#ffffff'
    inner.style.boxShadow = active
      ? `0 0 0 3px ${color}33, 0 10px 22px rgba(15,23,42,0.22)`
      : '0 6px 16px rgba(15,23,42,0.18)'
    return
  }
  if (markerKind === 'icon') {
    // 自定义点图标：保留深色底，active 加主色描边环
    inner.style.transform = active ? 'scale(1.25)' : ''
    inner.style.boxShadow = active
      ? `0 0 0 3px ${color}55, 0 8px 18px rgba(15,23,42,0.28)`
      : '0 4px 12px rgba(15,23,42,0.18)'
    return
  }
  inner.style.transform = active ? 'scale(1.25)' : ''
  inner.style.backgroundColor = active ? color : '#ffffff'
  inner.style.color = active ? '#ffffff' : color
}

/** 外观变体：在 applyMarkerActive 之后调用，只改透明度/空心/徽标文本，不碰根 transform */
export function applyMarkerVariant(el: HTMLElement, variant: MarkerVariant | undefined): void {
  if (!variant) return
  const inner = markerInnerElement(el)
  if (variant.emphasis === 'muted') {
    el.style.opacity = '0.45'
  } else if (variant.emphasis === 'hollow') {
    inner.style.backgroundColor = 'transparent'
    inner.style.border = '2px dashed #94a3b8'
    inner.style.color = '#94a3b8'
  }
  // 缩略图/图标 marker 的序号已搬到角标，内层不再写文本
  const markerKind = el.dataset.markerKind ?? 'number'
  if (markerKind === 'number' && variant.badge && inner.textContent !== variant.badge) {
    inner.textContent = variant.badge
  }
  if (markerKind !== 'number' && variant.badge) {
    const badge = el.querySelector('[data-marker-badge]')
    if (badge && badge.textContent !== variant.badge) badge.textContent = variant.badge
  }
}

/** 序号角标（缩略图/图标 marker 用）：绝对定位到右下角，不污染内层圆片 */
function appendCornerBadge(el: HTMLElement, badge: string, color: string) {
  const corner = document.createElement('span')
  corner.dataset.markerBadge = 'true'
  corner.textContent = badge
  corner.style.position = 'absolute'
  corner.style.right = '-4px'
  corner.style.bottom = '-4px'
  corner.style.minWidth = '18px'
  corner.style.height = '18px'
  corner.style.padding = badge.length > 2 ? '0 5px' : '0'
  corner.style.borderRadius = '9999px'
  corner.style.background = color
  corner.style.color = '#ffffff'
  corner.style.fontSize = '10px'
  corner.style.fontWeight = '700'
  corner.style.display = 'inline-flex'
  corner.style.alignItems = 'center'
  corner.style.justifyContent = 'center'
  corner.style.border = '2px solid #ffffff'
  corner.style.boxShadow = '0 2px 6px rgba(15,23,42,0.22)'
  corner.style.pointerEvents = 'none'
  el.appendChild(corner)
}

/** 序号圆片（无图无图标时的原样回退），从 marker 内层重建 */
function renderNumberInner(inner: HTMLElement, label: string, color: string, fontSize: string) {
  inner.textContent = label
  inner.style.backgroundColor = '#ffffff'
  inner.style.color = color
  inner.style.fontSize = fontSize
  inner.style.display = 'flex'
  inner.style.alignItems = 'center'
  inner.style.justifyContent = 'center'
}

export function createNumberedMarker(
  layout: MarkerLayout,
  options: {
    color: string
    active?: boolean
    clickable?: boolean
    variant?: MarkerVariant
    /** B3：可选封面缩略图；加载失败回退到序号圆点 */
    image?: string | null
  },
): HTMLDivElement {
  const badgeText = options.variant?.badge ?? layout.label
  const placeKind = options.variant?.placeKind ?? null
  const image = options.image ?? null
  const markerKind: 'image' | 'icon' | 'number' = image ? 'image' : placeKind ? 'icon' : 'number'

  const baseSize = layout.overlapCount > 1 ? 28 : 24
  const size = markerKind === 'image' ? 44 : baseSize
  const el = document.createElement('div')
  el.className = 'route-preview-marker'
  el.dataset.pointId = layout.id
  el.dataset.offsetX = String(layout.offsetX)
  el.dataset.offsetY = String(layout.offsetY)
  el.dataset.markerColor = options.color
  el.dataset.markerKind = markerKind
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  // L15：无点选回调的场景（如路书页）marker 不可点——不给 pointer 游标、不挂 click
  if (options.clickable !== false) el.style.cursor = 'pointer'
  const name = layout.title ?? layout.label
  el.title = layout.overlapCount > 1 ? `${name}（与 ${layout.overlapCount - 1} 个点位接近）` : name

  const inner = document.createElement('span')
  inner.className = `${MARKER_INNER_CLASS} flex items-center justify-center rounded-full font-bold`
  inner.style.width = '100%'
  inner.style.height = '100%'
  inner.style.border = `2px solid ${options.color}`
  inner.style.fontSize = badgeText.length > 2 ? '10px' : '12px'
  inner.style.boxShadow = layout.overlapCount > 1 ? '0 6px 18px rgba(15,23,42,0.16)' : '0 4px 12px rgba(15,23,42,0.12)'
  inner.style.position = 'relative'
  el.appendChild(inner)

  if (markerKind === 'image' && image) {
    // 缩略图：44px 圆形封面，白色 2px 描边，object-fit cover
    inner.style.border = '2px solid #ffffff'
    inner.style.overflow = 'hidden'
    inner.style.backgroundColor = '#e2e8f0'
    const img = document.createElement('img')
    img.src = image
    img.alt = name
    img.loading = 'lazy'
    img.decoding = 'async'
    img.style.width = '100%'
    img.style.height = '100%'
    img.style.objectFit = 'cover'
    img.style.display = 'block'
    img.onerror = () => {
      // 加载失败：回退到序号圆点（同时去掉角标，避免与内层文本重复）
      el.dataset.markerKind = 'number'
      inner.style.overflow = ''
      inner.style.border = `2px solid ${options.color}`
      img.remove()
      el.querySelector('[data-marker-badge]')?.remove()
      renderNumberInner(inner, badgeText, options.color, badgeText.length > 2 ? '10px' : '12px')
      applyMarkerActive(el, el.dataset.active === 'true')
      applyMarkerVariant(el, options.variant)
    }
    inner.appendChild(img)
    appendCornerBadge(el, badgeText, options.color)
  } else if (markerKind === 'icon' && placeKind) {
    // 自定义点（无图）：深底 + 白色 lucide 图标；徽标仍在右下角
    inner.style.backgroundColor = '#0f172a'
    inner.style.border = '2px solid #ffffff'
    inner.style.color = '#ffffff'
    inner.innerHTML = PLACE_KIND_ICON_SVG[placeKind]
    appendCornerBadge(el, badgeText, options.color)
  } else {
    inner.textContent = badgeText
  }

  applyMarkerActive(el, options.active ?? false)
  applyMarkerVariant(el, options.variant)
  return el
}
