import { describe, expect, it } from 'vitest'
import { computeCoreBounds, JAPAN_FALLBACK_BOUNDS } from '@/components/home/mapTeaserBounds'
import type { HomeMapCell } from '@/lib/home/types'

const TOKYO: HomeMapCell[] = [
  { lng: 139.6, lat: 35.6, count: 1000 },
  { lng: 139.7, lat: 35.7, count: 980 },
  { lng: 139.8, lat: 35.6, count: 960 },
  { lng: 139.7, lat: 35.5, count: 940 },
  { lng: 139.6, lat: 35.8, count: 920 },
  { lng: 139.9, lat: 35.7, count: 840 },
  { lng: 140.0, lat: 35.6, count: 840 },
  { lng: 139.5, lat: 35.7, count: 840 },
  { lng: 139.8, lat: 35.8, count: 840 },
  { lng: 139.7, lat: 35.9, count: 840 },
]
const KYOTO: HomeMapCell = { lng: 135.77, lat: 35.02, count: 800 }
const OSAKA: HomeMapCell = { lng: 135.5, lat: 34.69, count: 700 }
const EUROPE: HomeMapCell[] = [
  { lng: 2.35, lat: 48.85, count: 120 },
  { lng: 12.5, lat: 41.9, count: 100 },
  { lng: -0.13, lat: 51.5, count: 80 },
]
const NORTH_AMERICA: HomeMapCell[] = [
  { lng: -74.0, lat: 40.7, count: 120 },
  { lng: -118.24, lat: 34.05, count: 80 },
]
const AUSTRALIA: HomeMapCell = { lng: 151.2, lat: -33.9, count: 50 }

/** 东京大格子 9000 + 京阪 1500 + 欧洲 300 + 北美 200 + 澳洲 50 */
function cellsWithOverseasTail(): HomeMapCell[] {
  return [...TOKYO, KYOTO, OSAKA, ...EUROPE, ...NORTH_AMERICA, AUSTRALIA]
}

function contains(bounds: [number, number, number, number], cell: HomeMapCell): boolean {
  return cell.lng >= bounds[0] && cell.lng <= bounds[2] && cell.lat >= bounds[1] && cell.lat <= bounds[3]
}

describe('computeCoreBounds', () => {
  it('以头部格子质心为中心扩张，东京与京阪都在视野内', () => {
    const bounds = computeCoreBounds(cellsWithOverseasTail())

    for (const cell of TOKYO) expect(contains(bounds, cell)).toBe(true)
    expect(contains(bounds, KYOTO)).toBe(true)
    expect(contains(bounds, OSAKA)).toBe(true)
  })

  it('欧洲 / 北美 / 澳洲的零散格子被挡在视野外', () => {
    const bounds = computeCoreBounds(cellsWithOverseasTail())

    for (const cell of [...EUROPE, ...NORTH_AMERICA, AUSTRALIA]) {
      expect(contains(bounds, cell)).toBe(false)
    }
  })

  it('正方形框以质心为中心，且各向外扩 1.5°', () => {
    const bounds = computeCoreBounds(cellsWithOverseasTail())

    const centerLng = (bounds[0] + bounds[2]) / 2
    const centerLat = (bounds[1] + bounds[3]) / 2
    expect(centerLng).toBeCloseTo(139.68, 6)
    expect(centerLat).toBeCloseTo(171068 / 4800, 6)
    // 半径 5° + 外扩 1.5°，经纬方向边长一致
    expect(bounds[2] - bounds[0]).toBeCloseTo(13, 6)
    expect(bounds[3] - bounds[1]).toBeCloseTo(13, 6)
  })

  it('coverage 给 1 时所有格子都算进来（含海外零散格子）', () => {
    const bounds = computeCoreBounds(cellsWithOverseasTail(), 1)

    for (const cell of cellsWithOverseasTail()) expect(contains(bounds, cell)).toBe(true)
  })

  it('空数组回退到日本范围', () => {
    expect(computeCoreBounds([])).toEqual([122, 24, 146, 46])
    expect(JAPAN_FALLBACK_BOUNDS).toEqual([122, 24, 146, 46])
  })

  it('count 全是 0 / 坐标非法时同样回退，不返回 Infinity', () => {
    const junk = [{ lng: Number.NaN, lat: 35, count: 10 }, { lng: 139, lat: 35, count: 0 }] as HomeMapCell[]
    expect(computeCoreBounds(junk)).toEqual([122, 24, 146, 46])
  })

  it('不越出经纬度边界', () => {
    const bounds = computeCoreBounds([{ lng: 179.5, lat: 84.5, count: 10 }])
    expect(bounds[2]).toBeLessThanOrEqual(180)
    expect(bounds[3]).toBeLessThanOrEqual(85)
  })
})
