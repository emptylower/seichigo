import type { HomeMapCell } from '@/lib/home/types'

/** 首屏节点预算：点阵只是装饰，超出就按 count 取最密的那些 */
export const HERO_DOTS_MAX = 400

/** 品牌粉，与地图预览细点同色 */
const DOT_COLOR = '#ec4899'
const RADIUS = [1, 1.6, 2.4] as const
const OPACITY = [0.1, 0.14, 0.18] as const

function tier(count: number): 0 | 1 | 2 {
  if (count >= 1000) return 2
  if (count >= 100) return 1
  return 0
}

function bounds(cells: HomeMapCell[]): [number, number, number, number] {
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

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 首屏右上角的点阵背景：把地图预览用的同一份 0.1° 网格画成一张静态 SVG
 * （viewBox 按 bbox 归一化），纯装饰——`aria-hidden` + `pointer-events:none`，
 * 不加载地图库、不发请求。
 */
export default function HomeHeroDots({
  cells,
  bbox,
}: {
  cells: HomeMapCell[]
  bbox?: [number, number, number, number]
}) {
  if (!cells.length) return null

  const dots = cells.length > HERO_DOTS_MAX ? [...cells].sort((a, b) => b.count - a.count).slice(0, HERO_DOTS_MAX) : cells
  const [minLng, minLat, maxLng, maxLat] = bbox ?? bounds(dots)
  const spanLng = Math.max(maxLng - minLng, 0.0001)
  const spanLat = Math.max(maxLat - minLat, 0.0001)

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      className="h-full w-full"
    >
      {dots.map((cell, index) => {
        const level = tier(cell.count)
        return (
          <circle
            key={`${cell.lng}:${cell.lat}:${index}`}
            cx={round(((cell.lng - minLng) / spanLng) * 100)}
            cy={round(((maxLat - cell.lat) / spanLat) * 100)}
            r={RADIUS[level]}
            fill={DOT_COLOR}
            opacity={OPACITY[level]}
          />
        )
      })}
    </svg>
  )
}
