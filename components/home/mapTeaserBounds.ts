import type { HomeMapCell } from '@/lib/home/types'

/** 一个格子都没有（或全是脏数据）时的兜底视野：日本本土 */
export const JAPAN_FALLBACK_BOUNDS: [number, number, number, number] = [122, 24, 146, 46]

/** 核心框各向外扩的余量，避免最外圈的点贴边 */
const PAD_DEG = 1.5

/** 计算质心用的头部格子数量 */
const CENTROID_TOP_N = 5

/** 正方形半径的起始值与上限（上限足够覆盖全球，保证循环一定收敛） */
const MIN_RADIUS_DEG = 3
const MAX_RADIUS_DEG = 360

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 预生成的 bbox 含大量海外小格子（欧洲、北美、澳洲…），按 count 累计取覆盖比例会
 * 把它们一起纳入，结果框仍是整个地球，日本的细点和城市标签几乎不可见。
 *
 * 这里改用空间规则：先用 count 最大的前 5 个格子求加权质心（实际落在东京附近），
 * 再以质心为中心、以经纬度"半径" r 度构造正方形框，r 从 3 起每次 +1，直到框内
 * count 之和达到 `coverage` 比例为止，最后各向外扩 1.5° 并 clamp 到 ±180/±85。
 *
 * 返回 `[minLng, minLat, maxLng, maxLat]`。
 */
export function computeCoreBounds(cells: HomeMapCell[], coverage = 0.9): [number, number, number, number] {
  const valid = (cells ?? []).filter(
    (cell) => Number.isFinite(cell?.lng) && Number.isFinite(cell?.lat) && Number.isFinite(cell?.count) && cell.count > 0,
  )
  const total = valid.reduce((sum, cell) => sum + cell.count, 0)
  if (!valid.length || total <= 0) return [...JAPAN_FALLBACK_BOUNDS]

  const sorted = [...valid].sort((a, b) => b.count - a.count)
  const top = sorted.slice(0, CENTROID_TOP_N)
  const topWeight = top.reduce((sum, cell) => sum + cell.count, 0)
  const centerLng = top.reduce((sum, cell) => sum + cell.lng * cell.count, 0) / topWeight
  const centerLat = top.reduce((sum, cell) => sum + cell.lat * cell.count, 0) / topWeight

  const target = total * clamp(coverage, 0, 1)
  let radius = MIN_RADIUS_DEG
  while (radius < MAX_RADIUS_DEG) {
    const inside = valid.reduce(
      (sum, cell) =>
        Math.abs(cell.lng - centerLng) <= radius && Math.abs(cell.lat - centerLat) <= radius ? sum + cell.count : sum,
      0,
    )
    if (inside >= target) break
    radius += 1
  }

  const half = radius + PAD_DEG
  return [
    clamp(centerLng - half, -180, 180),
    clamp(centerLat - half, -85, 85),
    clamp(centerLng + half, -180, 180),
    clamp(centerLat + half, -85, 85),
  ]
}
