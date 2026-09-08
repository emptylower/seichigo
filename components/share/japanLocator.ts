import japanOutline from '@/components/share/data/japan-outline.json'

export type LocatorBox = { x: number; y: number; width: number; height: number }
/** [minLon, minLat, maxLon, maxLat] */
export type LocatorBBox = readonly [number, number, number, number]
export type LocatorGeometry = { bbox: LocatorBBox; rings: number[][][] }

/** Natural Earth 50m 日本轮廓（公有领域），34 环 1097 点 */
export const JAPAN_OUTLINE = japanOutline as unknown as LocatorGeometry

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
