import { projectMapWorld } from '@/lib/home/mapWorld'
import type {
  HomeMapCell,
  HomeMapClusters,
  HomeMapWorldBounds,
  HomeMapWorldLabel,
} from '@/lib/home/types'

/**
 * 首页第二屏静态世界地图的纯函数层（generate-home-map-world.mts 与单测共用）。
 * 口径说明：海外地区标签的 count = cells 中落在该地区中心半径 1.2°（经纬度
 * 欧氏距离，不做纬度校正——巡礼点位密集区都在中低纬度，误差可忽略）圆内
 * 的所有格子 count 之和；日本城市标签直接沿用 home-map-clusters.json 的
 * labels（名字、count、经纬度原样）。
 */

/** §1 契约：太平洋居中视角，经度 -22 向东跨 345°（跨 180° 回绕），纬度 74 到 -52 */
export const WORLD_BOUNDS: HomeMapWorldBounds = {
  lngStart: -22,
  lngSpan: 345,
  latTop: 74,
  latBottom: -52,
}

export const IMG_2X_WIDTH = 2416
export const IMG_2X_HEIGHT = 882
export const IMG_1X_WIDTH = 1208
export const IMG_1X_HEIGHT = 441
export const IMAGE_2X_MAX_BYTES = 350 * 1024
export const MIN_OVERSEAS_LABEL_COUNT = 20
export const OVERSEAS_RADIUS_DEG = 1.2

/** 海外地区标签候选表（zh/en/ja 名与中心经纬度，固定写死；坐标来自计划 §1） */
export const OVERSEAS_LABEL_CANDIDATES: readonly {
  key: string
  name: { zh: string; en: string; ja: string }
  lng: number
  lat: number
}[] = [
  { key: 'seoul', name: { zh: '首尔', en: 'Seoul', ja: 'ソウル' }, lng: 126.98, lat: 37.57 },
  { key: 'shanghai', name: { zh: '上海', en: 'Shanghai', ja: '上海' }, lng: 121.47, lat: 31.23 },
  { key: 'taipei', name: { zh: '台北', en: 'Taipei', ja: '台北' }, lng: 121.56, lat: 25.03 },
  { key: 'hongkong', name: { zh: '香港', en: 'Hong Kong', ja: '香港' }, lng: 114.17, lat: 22.32 },
  { key: 'bangkok', name: { zh: '曼谷', en: 'Bangkok', ja: 'バンコク' }, lng: 100.5, lat: 13.75 },
  { key: 'singapore', name: { zh: '新加坡', en: 'Singapore', ja: 'シンガポール' }, lng: 103.82, lat: 1.35 },
  { key: 'sydney', name: { zh: '悉尼', en: 'Sydney', ja: 'シドニー' }, lng: 151.21, lat: -33.87 },
  { key: 'los-angeles', name: { zh: '洛杉矶', en: 'Los Angeles', ja: 'ロサンゼルス' }, lng: -118.24, lat: 34.05 },
  { key: 'new-york', name: { zh: '纽约', en: 'New York', ja: 'ニューヨーク' }, lng: -73.99, lat: 40.73 },
  { key: 'london', name: { zh: '伦敦', en: 'London', ja: 'ロンドン' }, lng: -0.13, lat: 51.51 },
  { key: 'paris', name: { zh: '巴黎', en: 'Paris', ja: 'パリ' }, lng: 2.35, lat: 48.86 },
  { key: 'venice', name: { zh: '威尼斯', en: 'Venice', ja: 'ヴェネツィア' }, lng: 12.34, lat: 45.44 },
  { key: 'colmar', name: { zh: '科尔马', en: 'Colmar', ja: 'コルマール' }, lng: 7.36, lat: 48.08 },
  { key: 'moscow', name: { zh: '莫斯科', en: 'Moscow', ja: 'モスクワ' }, lng: 37.62, lat: 55.75 },
  { key: 'honolulu', name: { zh: '檀香山', en: 'Honolulu', ja: 'ホノルル' }, lng: -157.86, lat: 21.31 },
]

/** clusters.labels 里的日本城市 zh 名 → 标签 key（clusters 数据里 en/ja 有缺失，key 固定写死保证稳定） */
export const JAPAN_LABEL_KEYS: Record<string, string> = {
  东京: 'tokyo',
  京都: 'kyoto',
  镰仓: 'kamakura',
  山梨: 'yamanashi',
  名古屋: 'nagoya',
  饭能: 'hanno',
  大阪: 'osaka',
  沼津: 'numazu',
}

/** 海外中心 radiusDeg 度（经纬度欧氏距离）圆内所有格子 count 之和 */
export function overseasCountFor(
  cells: HomeMapCell[],
  centerLng: number,
  centerLat: number,
  radiusDeg: number = OVERSEAS_RADIUS_DEG
): number {
  let count = 0
  for (const cell of cells) {
    if (Math.hypot(cell.lng - centerLng, cell.lat - centerLat) <= radiusDeg) {
      count += cell.count
    }
  }
  return count
}

/**
 * §1 契约的标签表：日本城市沿用 clusters.labels 原样，海外按半径聚合、
 * count < 20 丢弃；合并后按 count 降序（同 count 按 key 升序保证确定性），
 * primary 只给 count 最大的一条。
 */
export function buildWorldLabels(
  clusters: Pick<HomeMapClusters, 'cells' | 'labels'>
): HomeMapWorldLabel[] {
  const labels: HomeMapWorldLabel[] = []

  for (const label of clusters.labels ?? []) {
    labels.push({
      key: JAPAN_LABEL_KEYS[label.name.zh] ?? label.name.zh,
      name: { ...label.name },
      count: label.count,
      lng: label.lng,
      lat: label.lat,
    })
  }

  for (const candidate of OVERSEAS_LABEL_CANDIDATES) {
    const count = overseasCountFor(clusters.cells, candidate.lng, candidate.lat)
    if (count < MIN_OVERSEAS_LABEL_COUNT) continue
    labels.push({
      key: candidate.key,
      name: { ...candidate.name },
      count,
      lng: candidate.lng,
      lat: candidate.lat,
    })
  }

  labels.sort((a, b) => (b.count !== a.count ? b.count - a.count : a.key.localeCompare(b.key)))
  if (labels.length > 0) {
    labels[0] = { ...labels[0], primary: true }
  }
  return labels
}

/** TUBS 底图重上色表（已验证这几个色值就是 SVG 里出现的全部地形色） */
const RECOLOR_PAIRS: readonly (readonly [string, string])[] = [
  ['#FDFBE5', '#FFFFFF'], // 陆地
  ['#C9EBFC', '#DCEBFA'], // 海洋
  ['#1178AC', '#B9D3EA'], // 海岸线描边
  ['#646565', '#E3E6EB'], // 国界
  ['#656565', '#E3E6EB'], // 国界（变体拼写）
  ['#C12838', 'none'], // 红圈标记
  ['#F7BC60', 'none'], // 橙色小方块
]

/** 对底图 SVG 文本做字符串替换重上色（陆地白、海洋淡蓝、描边浅灰蓝、去掉标记） */
export function recolorWorldSvg(svg: string): string {
  let out = svg
  for (const [from, to] of RECOLOR_PAIRS) {
    out = out.split(from).join(to)
  }
  return out
}

/** 点位半径按 count 对数插值（count 1 → rMin，count === maxCount → rMax；热点城市密集，对数让长尾可见） */
export function radiusForCount(
  count: number,
  maxCount: number,
  rMin: number,
  rMax: number
): number {
  if (!Number.isFinite(count) || count <= 1) return rMin
  const safeMax = Math.max(maxCount, count)
  const t = Math.log(count) / Math.log(safeMax)
  return rMin + (rMax - rMin) * t
}

const PINK = '#ec4899'

/**
 * 烘焙点位各层的半径与透明度（§A-3 看图回调，取 A-1 与 A-2 之间）。数值都是
 * **2x 图上的像素值**（1x 由整图缩半得到）：A-2 的 2.5→7 在 1x 显示（约
 * 1150px 宽）下日本只剩一条细粉带、欧洲几乎看不见；回调后日本是一片明显
 * 发亮但仍能看出内部疏密纹理的粉色区域，海外是一眼能看到的小簇。
 */
export const GLOW_R_2X: readonly [number, number] = [3.5, 10]
export const MID_R_2X: readonly [number, number] = [1.6, 4]
export const CORE_R_2X: readonly [number, number] = [0.8, 1.8]
export const GLOW_CENTER_OPACITY = 0.3
export const MID_OPACITY = 0.34
export const CORE_OPACITY = 0.92

/**
 * 烘焙点位的 SVG 叠层：每个格子三层 circle（光晕 radialGradient 中心 0.3 →
 * 边缘 0，代替 blur——librsvg 对 SVG filter 支持不稳；中层 0.34；核心 0.92），
 * 半径按 count 对数插值（基准为 §A-3 的 2x 像素值，radiusScale 缺省 1）。
 * 投到画布外的格子直接跳过。三个 pass 分层绘制保证核心永远在最上。
 */
export function buildPointsOverlaySvg(
  cells: HomeMapCell[],
  bounds: HomeMapWorldBounds,
  width: number,
  height: number,
  radiusScale = 1
): string {
  let maxCount = 0
  for (const cell of cells) maxCount = Math.max(maxCount, cell.count)

  const points: Array<{ x: number; y: number; count: number }> = []
  for (const cell of cells) {
    const { xPct, yPct } = projectMapWorld(bounds, cell.lng, cell.lat)
    const x = (xPct / 100) * width
    const y = (yPct / 100) * height
    if (x < 0 || x > width || y < 0 || y > height) continue
    points.push({ x, y, count: cell.count })
  }

  const fmt = (value: number) => Number(value.toFixed(2))
  const circle = (p: { x: number; y: number; count: number }, rMin: number, rMax: number, fill: string, opacity?: number) =>
    `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(radiusForCount(p.count, maxCount, rMin, rMax) * radiusScale)}" fill="${fill}"${opacity !== undefined ? ` opacity="${opacity}"` : ''}/>`

  const glow = points.map((p) => circle(p, GLOW_R_2X[0], GLOW_R_2X[1], 'url(#pw-glow)')).join('')
  const mid = points.map((p) => circle(p, MID_R_2X[0], MID_R_2X[1], PINK, MID_OPACITY)).join('')
  const core = points.map((p) => circle(p, CORE_R_2X[0], CORE_R_2X[1], PINK, CORE_OPACITY)).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><radialGradient id="pw-glow"><stop offset="0" stop-color="${PINK}" stop-opacity="${GLOW_CENTER_OPACITY}"/><stop offset="1" stop-color="${PINK}" stop-opacity="0"/></radialGradient></defs>${glow}${mid}${core}</svg>`
}

export type WorldArtifactChecks = {
  labels: HomeMapWorldLabel[]
  bounds: HomeMapWorldBounds
  width2x: number
  height2x: number
  width1x: number
  height1x: number
  bytes2x: number
}

/** 脚本硬断言（§1 契约）：labels ≥ 6、每条经纬度在 bounds 内、尺寸正确、2x 图 ≤ 350 KB */
export function assertWorldArtifact(checks: WorldArtifactChecks): void {
  const problems: string[] = []

  if (checks.labels.length < 6) {
    problems.push(`labels ${checks.labels.length} < 6`)
  }
  for (const label of checks.labels) {
    const { xPct } = projectMapWorld(checks.bounds, label.lng, checks.bounds.latTop)
    if (!(xPct >= 0 && xPct <= 100)) problems.push(`label ${label.key} lng ${label.lng} out of bounds`)
    const { yPct } = projectMapWorld(checks.bounds, checks.bounds.lngStart, label.lat)
    if (!(yPct >= 0 && yPct <= 100)) problems.push(`label ${label.key} lat ${label.lat} out of bounds`)
  }

  if (checks.width2x !== IMG_2X_WIDTH || checks.height2x !== IMG_2X_HEIGHT) {
    problems.push(`2x image is ${checks.width2x}x${checks.height2x}, want ${IMG_2X_WIDTH}x${IMG_2X_HEIGHT}`)
  }
  if (checks.width1x !== IMG_1X_WIDTH || checks.height1x !== IMG_1X_HEIGHT) {
    problems.push(`1x image is ${checks.width1x}x${checks.height1x}, want ${IMG_1X_WIDTH}x${IMG_1X_HEIGHT}`)
  }
  if (checks.bytes2x > IMAGE_2X_MAX_BYTES) {
    problems.push(`2x image is ${checks.bytes2x} bytes (budget ${IMAGE_2X_MAX_BYTES})`)
  }

  if (problems.length > 0) {
    throw new Error(`home-map-world artifact invalid: ${problems.join('; ')}`)
  }
}
