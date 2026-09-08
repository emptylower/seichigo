export type LocatorBox = { x: number; y: number; width: number; height: number }
/** [minLon, minLat, maxLon, maxLat] */
export type LocatorBBox = readonly [number, number, number, number]
export type LocatorGeometry = { bbox: LocatorBBox; rings: number[][][] }

let outlinePromise: Promise<LocatorGeometry> | null = null

/**
 * Natural Earth 50m 日本轮廓（公有领域），34 环 1097 点。
 * 只有日本境内的点位才画轮廓，所以 JSON 走动态 import 懒加载：
 * 海外点位与不开分享面板的会话都不用为这几十 KB 买单。promise 缓存在模块级，只解析一次。
 */
export function loadJapanOutline(): Promise<LocatorGeometry> {
  outlinePromise ??= import('@/lib/share/data/japan-outline.json').then(
    (module) => (module.default ?? module) as unknown as LocatorGeometry,
  )
  return outlinePromise
}

type Projection = {
  originX: number
  originY: number
  scale: number
  lonScale: number
  minLon: number
  maxLat: number
}

/**
 * 等距圆柱投影 + cos(平均纬度) 横向修正。
 * 这个尺度（一张 240px 的定位小图）用不着墨卡托：等距圆柱在单一 bbox 内的形变
 * 只体现在横向被拉宽，乘一个 cos(平均纬度) 就够了。
 * 等比缩放取两轴较小者，剩下的方向居中留白，保证四角都落在框内。
 */
function buildProjection(box: LocatorBox, bbox: LocatorBBox): Projection {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const lonScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const spanLon = Math.max(1e-9, (maxLon - minLon) * lonScale)
  const spanLat = Math.max(1e-9, maxLat - minLat)
  const scale = Math.min(box.width / spanLon, box.height / spanLat)
  return {
    originX: box.x + (box.width - spanLon * scale) / 2,
    originY: box.y + (box.height - spanLat * scale) / 2,
    scale,
    lonScale,
    minLon,
    maxLat,
  }
}

function project(projection: Projection, lon: number, lat: number): { x: number; y: number } {
  return {
    x: projection.originX + (lon - projection.minLon) * projection.lonScale * projection.scale,
    y: projection.originY + (projection.maxLat - lat) * projection.scale,
  }
}

export function projectToBox(
  lon: number,
  lat: number,
  box: LocatorBox,
  bbox: LocatorBBox,
): { x: number; y: number } {
  return project(buildProjection(box, bbox), lon, lat)
}

export const LOCATOR_COLORS = {
  fill: '#fbcfe8',
  stroke: '#ec4899',
  marker: '#db2777',
} as const

/** 只用到 canvas 的这几个成员，测试里给个同形状的桩就够 */
export type LocatorContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'closePath'
  | 'moveTo'
  | 'lineTo'
  | 'fill'
  | 'stroke'
  | 'arc'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
>

export function drawJapanLocator(
  ctx: LocatorContext,
  box: LocatorBox,
  point: { lat: number; lng: number } | null,
  geometry: LocatorGeometry,
): void {
  // 投影只算一次：1097 个点每个都重建投影是纯浪费
  const projection = buildProjection(box, geometry.bbox)
  const shortSide = Math.min(box.width, box.height)

  ctx.save()
  ctx.fillStyle = LOCATOR_COLORS.fill
  ctx.strokeStyle = LOCATOR_COLORS.stroke
  ctx.lineWidth = Math.max(1, shortSide / 160)
  for (const ring of geometry.rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue
    ctx.beginPath()
    for (let index = 0; index < ring.length; index++) {
      const pair = ring[index]!
      const projected = project(projection, pair[0]!, pair[1]!)
      if (index === 0) ctx.moveTo(projected.x, projected.y)
      else ctx.lineTo(projected.x, projected.y)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  if (point) {
    const projected = project(projection, point.lng, point.lat)
    ctx.beginPath()
    ctx.fillStyle = LOCATOR_COLORS.marker
    ctx.arc(projected.x, projected.y, Math.max(3, shortSide * 0.035), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
