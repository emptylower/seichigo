import type { HomeMapCell, HomeMapClusters, HomeMapLabel } from './types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const WORLD_BBOX: [number, number, number, number] = [-180, -90, 180, 90]

/** 由 cells 计算 [minLng, minLat, maxLng, maxLat]；无 cells 时退回世界范围 */
function computeCellsBbox(cells: HomeMapCell[]): [number, number, number, number] {
  if (cells.length === 0) return WORLD_BBOX

  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const cell of cells) {
    if (cell.lng < minLng) minLng = cell.lng
    if (cell.lng > maxLng) maxLng = cell.lng
    if (cell.lat < minLat) minLat = cell.lat
    if (cell.lat > maxLat) maxLat = cell.lat
  }
  return [minLng, minLat, maxLng, maxLat]
}

/** 读取 content/generated/home-map-clusters.json 时的形状校验；不合法返回 null */
export function parseHomeMapClusters(raw: unknown): HomeMapClusters | null {
  if (!isPlainObject(raw)) return null
  const generatedAt = typeof raw.generatedAt === 'string' ? raw.generatedAt.trim() : ''
  if (!generatedAt) return null
  if (!Number.isFinite(Number(raw.totalPoints)) || Number(raw.totalPoints) < 0) return null
  if (!Array.isArray(raw.cells)) return null

  const cells: HomeMapCell[] = []
  for (const cell of raw.cells) {
    if (!isPlainObject(cell)) return null
    const lng = Number(cell.lng)
    const lat = Number(cell.lat)
    const count = Number(cell.count)
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(count) || count <= 0) return null
    cells.push({ lng, lat, count })
  }

  const labels = parseHomeMapLabels(raw.labels)
  if (labels === null) return null

  return { generatedAt, totalPoints: Number(raw.totalPoints), cells, labels, bbox: computeCellsBbox(cells) }
}

/** labels 缺省为空数组（前端无标签也能渲染）；存在时逐条校验，en/ja 缺失回退 zh；不合法返回 null */
function parseHomeMapLabels(rawLabels: unknown): HomeMapLabel[] | null {
  if (rawLabels === undefined) return []
  if (!Array.isArray(rawLabels)) return null

  const labels: HomeMapLabel[] = []
  for (const label of rawLabels) {
    if (!isPlainObject(label) || !isPlainObject(label.name)) return null
    const zh = typeof label.name.zh === 'string' ? label.name.zh.trim() : ''
    if (!zh) return null
    const fallback = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : zh
    const lng = Number(label.lng)
    const lat = Number(label.lat)
    const count = Number(label.count)
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(count) || count <= 0) {
      return null
    }
    labels.push({
      name: { zh, en: fallback(label.name.en), ja: fallback(label.name.ja) },
      lng,
      lat,
      count,
    })
  }
  return labels
}

export type ClusterPointInput = {
  lat: number
  lng: number
}

function roundCell(value: number): number {
  return Number(value.toFixed(6))
}

/** 浮点边界容差：35.2/0.1 = 351.999…94，直接 floor 会掉进上一格 */
const CELL_INDEX_EPSILON = 1e-9

/**
 * §0 契约的网格聚合（generate-home-map-clusters 的核心纯函数）：
 * 把带坐标的点位按 cellDeg（首页用 0.1°）网格聚合计数，格心作为 cell 坐标，
 * 按 count 降序（同 count 按 lng/lat 升序保证确定性），最多保留 maxCells 个。
 * 非法坐标（NaN/Infinity）直接跳过。
 */
export function aggregateCells(
  points: ClusterPointInput[],
  cellDeg: number,
  maxCells: number
): HomeMapCell[] {
  if (!Number.isFinite(cellDeg) || cellDeg <= 0 || !Number.isFinite(maxCells) || maxCells <= 0) {
    return []
  }

  const counts = new Map<string, { lng: number; lat: number; count: number }>()
  for (const point of points) {
    const lat = Number(point?.lat)
    const lng = Number(point?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const col = Math.floor(lng / cellDeg + CELL_INDEX_EPSILON)
    const row = Math.floor(lat / cellDeg + CELL_INDEX_EPSILON)
    const key = `${col}:${row}`
    const existing = counts.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    counts.set(key, {
      lng: roundCell(col * cellDeg + cellDeg / 2),
      lat: roundCell(row * cellDeg + cellDeg / 2),
      count: 1,
    })
  }

  return Array.from(counts.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      if (a.lng !== b.lng) return a.lng - b.lng
      return a.lat - b.lat
    })
    .slice(0, Math.floor(maxCells))
}

/** pickCityLabels 的城市候选：坐标为该城市全部点位的逐维中位数（脚本侧构建） */
export type CityLabelCandidate = {
  name: { zh: string; en?: string | null; ja?: string | null }
  lat: number
  lng: number
  /** count 并列时的决胜键（升序），保证确定性；缺省用 name.zh */
  tieKey?: string
  /** 城市正统度（组内点位数）：间距合并时权重高的留名，防止小地名抢走都市圈标签 */
  weight?: number
}

export type PickCityLabelsOptions = {
  /** 城市质心统计格子 count 的半径（km） */
  radiusKm?: number
  /** 相距更近的两个标签只保留 count 更高的（都市圈合并，东京-横滨 28km 合并、京都-大阪 43km 保留） */
  minSeparationKm?: number
  maxLabels?: number
}

const EARTH_RADIUS_KM = 6371.0088

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = Math.PI / 180
  const s =
    Math.sin(((bLat - aLat) * toRad) / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(((bLng - aLng) * toRad) / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s))
}

/**
 * §0 契约的城市名标签（generate-home-map-clusters 的核心纯函数）：
 * 对每个城市候选统计质心 radiusKm（默认 25km）内格子的 count 之和，count > 0
 * 的进入间距合并：按 weight（城市正统度，默认 1）降序依序选入，与已选标签
 * 相距 < minSeparationKm（默认 35km）的跳过（都市圈合并，东京-横滨 28km 合并、
 * 京都-大阪 43km 保留）；幸存者按 count 降序（同 count 按 tieKey 升序）取前
 * maxLabels（默认 8）条。坐标/名称非法的候选直接跳过。
 */
export function pickCityLabels(
  cells: HomeMapCell[],
  cities: CityLabelCandidate[],
  options: PickCityLabelsOptions = {}
): HomeMapLabel[] {
  const radiusKm = options.radiusKm ?? 25
  const minSeparationKm = options.minSeparationKm ?? 35
  const maxLabels = options.maxLabels ?? 8
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return []
  if (!Number.isFinite(minSeparationKm) || minSeparationKm < 0) return []
  if (!Number.isFinite(maxLabels) || maxLabels <= 0) return []

  type Scored = { candidate: CityLabelCandidate; lat: number; lng: number; count: number; weight: number }
  const tieOf = (entry: Scored) => entry.candidate.tieKey ?? entry.candidate.name.zh
  const byTieKey = (a: Scored, b: Scored) => {
    const aKey = tieOf(a)
    const bKey = tieOf(b)
    return aKey === bKey ? 0 : aKey < bKey ? -1 : 1
  }

  const scored: Scored[] = []
  for (const candidate of cities) {
    const lat = Number(candidate?.lat)
    const lng = Number(candidate?.lng)
    const zh = candidate?.name?.zh
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (typeof zh !== 'string' || !zh.trim()) continue
    const weight = candidate.weight === undefined ? 1 : Number(candidate.weight)
    if (!Number.isFinite(weight) || weight <= 0) continue

    let count = 0
    for (const cell of cells) {
      if (haversineKm(lat, lng, cell.lat, cell.lng) <= radiusKm) count += cell.count
    }
    if (count > 0) scored.push({ candidate, lat, lng, count, weight })
  }

  // 间距合并按 weight 降序：都市圈留"最正统"的城市名，而非质心碰巧最居中的小地名
  const byWeight = [...scored].sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : byTieKey(a, b)))
  const separated: Scored[] = []
  for (const entry of byWeight) {
    const tooClose = separated.some(
      (kept) => haversineKm(kept.lat, kept.lng, entry.lat, entry.lng) < minSeparationKm
    )
    if (!tooClose) separated.push(entry)
  }

  return separated
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : byTieKey(a, b)))
    .slice(0, Math.floor(maxLabels))
    .map(({ candidate, lat, lng, count }) => ({
      name: {
        zh: candidate.name.zh,
        en: candidate.name.en || candidate.name.zh,
        ja: candidate.name.ja || candidate.name.zh,
      },
      lng: roundCell(lng),
      lat: roundCell(lat),
      count,
    }))
}
