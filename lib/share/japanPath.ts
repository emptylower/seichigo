import japanOutlineJson from '@/lib/share/data/japan-outline.json'

/** 只要宽高：SVG 有自己的坐标系，原点固定在 (0,0) */
export type JapanBox = { width: number; height: number }

type JapanOutline = {
  bbox: readonly [number, number, number, number]
  rings: readonly (readonly (readonly [number, number])[])[]
}

const OUTLINE = japanOutlineJson as unknown as JapanOutline

export type JapanProjection = {
  originX: number
  originY: number
  scale: number
  lonScale: number
  minLon: number
  maxLat: number
}

/**
 * 等距圆柱投影 + cos(平均纬度) 横向修正，与下线前的
 * components/share/japanLocator.ts:35-48 逐行等价。
 * 这个尺度（一张 100-180px 的定位小图）用不着墨卡托：等距圆柱在单一 bbox 内
 * 的形变只体现在横向被拉宽，乘一个 cos(平均纬度) 就够了。
 * 等比缩放取两轴较小者，剩下的方向居中留白，保证四角都落在框内。
 */
export function buildJapanProjection(box: JapanBox): JapanProjection {
  const [minLon, minLat, maxLon, maxLat] = OUTLINE.bbox
  const lonScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const spanLon = Math.max(1e-9, (maxLon - minLon) * lonScale)
  const spanLat = Math.max(1e-9, maxLat - minLat)
  const scale = Math.min(box.width / spanLon, box.height / spanLat)
  return {
    originX: (box.width - spanLon * scale) / 2,
    originY: (box.height - spanLat * scale) / 2,
    scale,
    lonScale,
    minLon,
    maxLat,
  }
}

export function projectJapanPoint(
  projection: JapanProjection,
  lon: number,
  lat: number,
): { x: number; y: number } {
  return {
    x: projection.originX + (lon - projection.minLon) * projection.lonScale * projection.scale,
    y: projection.originY + (projection.maxLat - lat) * projection.scale,
  }
}

export function projectJapanLatLng(box: JapanBox, lat: number, lng: number): { x: number; y: number } {
  return projectJapanPoint(buildJapanProjection(box), lng, lat)
}

/**
 * 全部 34 个环拼成一条 SVG path 的 `d`：每个环 `M x y L … Z`。
 * 坐标保留 2 位小数——这个尺寸下肉眼看不出差别，串长能省一半多。
 */
export function buildJapanOutlinePath(box: JapanBox, precision = 2): string {
  const projection = buildJapanProjection(box)
  const round = (value: number) => Number(value.toFixed(precision))
  let d = ''
  for (const ring of OUTLINE.rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue
    let segment = ''
    for (let index = 0; index < ring.length; index++) {
      const pair = ring[index]!
      const point = projectJapanPoint(projection, pair[0]!, pair[1]!)
      segment += `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`
    }
    d += `${segment}Z`
  }
  return d
}
