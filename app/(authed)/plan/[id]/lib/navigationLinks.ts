/**
 * Google 地图导航链接（纯函数）。
 * - 单点：destination 直拼，起点留空 = 用户当前位置。
 * - 整日：origin/destination/waypoints；Google Maps URLs waypoints 上限
 *   桌面 9、移动端 3，超出按 maxWaypoints 切成多段（每段首尾相接）。
 * 坐标保留 6 位小数，参数值经 encodeURIComponent。
 */

export type NavigationPoint = { lat: number; lng: number }

function formatCoord(point: NavigationPoint): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`
}

const GOOGLE_MAPS_DIR_BASE = 'https://www.google.com/maps/dir/'

export function buildPointNavigationUrl(point: NavigationPoint): string {
  return `${GOOGLE_MAPS_DIR_BASE}?api=1&destination=${encodeURIComponent(formatCoord(point))}&travelmode=transit`
}

/** 桌面 9 / 移动端（pointer: coarse）3；无 window（SSR）按桌面 9。仅供调用方在 effect 里读（M7：渲染期禁用） */
export function defaultMaxNavigationWaypoints(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 9
  return window.matchMedia('(pointer: coarse)').matches ? 3 : 9
}

/**
 * 整日导航：按 maxWaypoints 切多段，每段首尾相接（下一段 origin = 上一段
 * destination）。1 个点退化为单点导航；0 个点返回空数组。
 * M7：纯函数不读 matchMedia——缺省恒按桌面 9；移动端 3 由调用方在 useEffect
 * 里判出后显式传入（首屏一律 9，避免 hydration mismatch）。
 */
export function buildDayNavigationUrls(
  points: NavigationPoint[],
  options: { maxWaypoints?: number } = {},
): string[] {
  const maxWaypoints = Math.max(1, Math.floor(options.maxWaypoints ?? 9))
  if (points.length === 0) return []
  if (points.length === 1) return [buildPointNavigationUrl(points[0]!)]

  const coords = points.map(formatCoord)
  const segments: string[] = []
  let start = 0
  while (start < coords.length - 1) {
    // 每段 origin + destination + 至多 maxWaypoints 个中继点
    const end = Math.min(start + maxWaypoints + 1, coords.length - 1)
    const origin = encodeURIComponent(coords[start]!)
    const destination = encodeURIComponent(coords[end]!)
    const waypoints = coords.slice(start + 1, end)
    const waypointsParam = waypoints.length
      ? `&waypoints=${encodeURIComponent(waypoints.join('|'))}`
      : ''
    segments.push(
      `${GOOGLE_MAPS_DIR_BASE}?api=1&origin=${origin}&destination=${destination}${waypointsParam}&travelmode=transit`,
    )
    start = end
  }
  return segments
}
