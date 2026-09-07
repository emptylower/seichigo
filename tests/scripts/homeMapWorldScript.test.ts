import { describe, expect, it } from 'vitest'
import {
  CORE_OPACITY,
  CORE_R_2X,
  GLOW_CENTER_OPACITY,
  GLOW_R_2X,
  IMAGE_2X_MAX_BYTES,
  IMG_1X_HEIGHT,
  IMG_1X_WIDTH,
  IMG_2X_HEIGHT,
  IMG_2X_WIDTH,
  MID_OPACITY,
  MID_R_2X,
  MIN_OVERSEAS_LABEL_COUNT,
  OVERSEAS_RADIUS_DEG,
  WORLD_BOUNDS,
  assertWorldArtifact,
  buildPointsOverlaySvg,
  buildWorldLabels,
  overseasCountFor,
  radiusForCount,
  recolorWorldSvg,
} from '../../scripts/homeMapWorldScript'
import type { HomeMapCell, HomeMapLabel } from '@/lib/home/types'

function cells(entries: Array<[number, number, number]>): HomeMapCell[] {
  return entries.map(([lng, lat, count]) => ({ lng, lat, count }))
}

describe('overseasCountFor（半径 1.2° 聚合口径）', () => {
  const center = { lng: -0.13, lat: 51.51 }

  it('sums cells inside the degree circle and excludes cells outside', () => {
    const input = cells([
      [center.lng, center.lat, 100], // 圆心
      [center.lng + 1.2, center.lat, 10], // 正好在半径上（≤）
      [center.lng + 0.6, center.lat + 0.6, 5], // 对角距离 ~0.85°，在圆内
      [center.lng + 1.0, center.lat + 1.0, 999], // 对角 ~1.41° > 1.2，排除
    ])
    expect(overseasCountFor(input, center.lng, center.lat)).toBe(115)
  })

  it('returns 0 when nothing is nearby', () => {
    expect(overseasCountFor(cells([[139.75, 35.65, 4868]]), center.lng, center.lat)).toBe(0)
    expect(overseasCountFor([], center.lng, center.lat)).toBe(0)
  })

  it('honours a custom radius', () => {
    const input = cells([[center.lng + 2, center.lat, 7]])
    expect(overseasCountFor(input, center.lng, center.lat, OVERSEAS_RADIUS_DEG)).toBe(0)
    expect(overseasCountFor(input, center.lng, center.lat, 2.5)).toBe(7)
  })
})

describe('buildWorldLabels（§1 标签表）', () => {
  const japanLabels: HomeMapLabel[] = [
    { name: { zh: '东京', en: 'Tokyo', ja: '東京' }, lng: 139.7, lat: 35.69, count: 13959 },
    { name: { zh: '京都', en: 'Kyoto', ja: '京都' }, lng: 135.77, lat: 35.01, count: 4392 },
  ]

  function clusters(overseasCells: HomeMapCell[]) {
    return { cells: overseasCells, labels: japanLabels }
  }

  it('keeps japan labels verbatim with stable keys and adds overseas aggregates above the cutoff', () => {
    const labels = buildWorldLabels(
      clusters(cells([[-0.1, 51.5, 30], [126.98, 37.57, 5]])) // 伦敦 30（≥20）、首尔 5（<20）
    )

    const keys = labels.map((label) => label.key)
    expect(keys).toContain('tokyo')
    expect(keys).toContain('kyoto')
    expect(keys).toContain('london')
    expect(keys).not.toContain('seoul')

    const tokyo = labels.find((label) => label.key === 'tokyo')
    expect(tokyo).toMatchObject({ count: 13959, lng: 139.7, lat: 35.69 })
    const london = labels.find((label) => label.key === 'london')
    expect(london?.name).toEqual({ zh: '伦敦', en: 'London', ja: 'ロンドン' })
    expect(london?.count).toBe(30)
  })

  it('drops overseas candidates under 20 points even when many cells add up', () => {
    // 15 个格子每个 1 → 15 < 20，不输出
    const small = cells(
      Array.from({ length: 15 }, (_, i) => [151.2 + i * 0.01, -33.87, 1])
    )
    expect(buildWorldLabels(clusters(small)).map((l) => l.key)).not.toContain('sydney')
  })

  it('sorts by count desc, gives primary to exactly one label, and tolerates empty clusters', () => {
    const labels = buildWorldLabels({
      labels: [],
      cells: cells([[-0.1, 51.5, 30], [139.7, 35.65, 500], [-118.24, 34.05, 21]]),
    })
    const counts = labels.map((label) => label.count)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(labels.filter((label) => label.primary)).toHaveLength(1)
    expect(labels[0]?.primary).toBe(true)

    expect(buildWorldLabels({ cells: [], labels: [] })).toEqual([])
  })

  it('falls back japan keys to the zh name when unmapped', () => {
    const labels = buildWorldLabels({
      cells: [],
      labels: [{ name: { zh: '稚内', en: '', ja: '' }, lng: 141.6, lat: 45.4, count: 40 }],
    })
    expect(labels[0]?.key).toBe('稚内')
  })

  it('uses MIN_OVERSEAS_LABEL_COUNT = 20 as the documented cutoff', () => {
    expect(MIN_OVERSEAS_LABEL_COUNT).toBe(20)
  })
})

describe('recolorWorldSvg', () => {
  it('replaces every known terrain color and neutralizes markers', () => {
    const svg = [
      '<path fill="#FDFBE5"/>',
      '<path fill="#C9EBFC"/>',
      '<path stroke="#1178AC"/>',
      '<path stroke="#646565"/>',
      '<path stroke="#656565"/>',
      '<circle fill="#C12838"/>',
      '<rect fill="#F7BC60"/>',
    ].join('')
    const out = recolorWorldSvg(svg)
    expect(out).toContain('fill="#FFFFFF"')
    expect(out).toContain('fill="#DCEBFA"')
    expect(out).toContain('stroke="#B9D3EA"')
    expect(out.match(/stroke="#E3E6EB"/g)).toHaveLength(2)
    expect(out).toContain('fill="none"')
    for (const gone of ['#FDFBE5', '#C9EBFC', '#1178AC', '#646565', '#656565', '#C12838', '#F7BC60']) {
      expect(out).not.toContain(gone)
    }
  })
})

describe('radiusForCount', () => {
  it('interpolates on a log scale between rMin and rMax', () => {
    expect(radiusForCount(1, 4868, 6, 22)).toBe(6)
    expect(radiusForCount(4868, 4868, 6, 22)).toBeCloseTo(22, 10)
    expect(radiusForCount(4868, 100, 6, 22)).toBeCloseTo(22, 10) // maxCount 小于 count 时兜底
    const mid = radiusForCount(100, 4868, 6, 22)
    expect(mid).toBeGreaterThan(6)
    expect(mid).toBeLessThan(radiusForCount(1000, 4868, 6, 22))
    expect(radiusForCount(0, 4868, 6, 22)).toBe(6)
  })
})

describe('buildPointsOverlaySvg', () => {
  it('uses the §A-3 point radii (2x-image pixels) so dense grids stay distinct dots', () => {
    expect(GLOW_R_2X).toEqual([3.5, 10])
    expect(MID_R_2X).toEqual([1.6, 4])
    expect(CORE_R_2X).toEqual([0.8, 1.8])
    expect(GLOW_CENTER_OPACITY).toBe(0.3)
    expect(MID_OPACITY).toBe(0.34)
    expect(CORE_OPACITY).toBe(0.92)
  })

  it('draws three stacked circles per in-bounds cell with a gradient glow instead of filters', () => {
    const svg = buildPointsOverlaySvg(
      cells([[139.75, 35.65, 4868], [-0.13, 51.51, 40]]),
      WORLD_BOUNDS,
      IMG_2X_WIDTH,
      IMG_2X_HEIGHT
    )

    expect(svg.match(/<circle /g)).toHaveLength(6)
    expect(svg).toContain('<radialGradient id="pw-glow"')
    expect(svg).toContain('stop-color="#ec4899" stop-opacity="0.3"')
    expect(svg).not.toContain('<filter')
    // glow → mid → core 三个 pass：核心 circle 排在最后
    // （needle 带上 fill，避免误匹配 defs 里的 stop-opacity）
    const coreIndex = svg.indexOf(`fill="#ec4899" opacity="${CORE_OPACITY}"`)
    const midIndex = svg.indexOf(`fill="#ec4899" opacity="${MID_OPACITY}"`)
    const glowIndex = svg.indexOf('url(#pw-glow)')
    expect(glowIndex).toBeGreaterThan(-1)
    expect(glowIndex).toBeLessThan(midIndex)
    expect(midIndex).toBeLessThan(coreIndex)
  })

  it('projects wraparound longitudes inside the canvas and skips out-of-bounds cells', () => {
    const svg = buildPointsOverlaySvg(
      cells([[190, 35.65, 100], [-170, 35.65, 100]]), // 同一点两种经度写法
      WORLD_BOUNDS,
      2416,
      882
    )
    const xs = Array.from(svg.matchAll(/cx="([\d.]+)"/g), (m) => m[1])
    expect(new Set(xs).size).toBe(1) // 两个格子投影到同一像素
    expect(Number(xs[0])).toBeGreaterThan(0)
    expect(Number(xs[0])).toBeLessThan(2416)

    const withOutside = buildPointsOverlaySvg(
      cells([[190, 35.65, 100], [-30, 0, 50]]), // -30° 在大西洋空档外
      WORLD_BOUNDS,
      2416,
      882
    )
    expect(withOutside.match(/<circle /g)).toHaveLength(3)
  })
})

describe('assertWorldArtifact（脚本硬断言）', () => {
  const labels = Array.from({ length: 6 }, (_, i) => ({
    key: `k${i}`,
    name: { zh: `城${i}`, en: `C${i}`, ja: `C${i}` },
    count: 100 - i,
    lng: 100 + i * 10,
    lat: 30 - i * 10,
  }))
  const base = {
    labels,
    bounds: WORLD_BOUNDS,
    width2x: IMG_2X_WIDTH,
    height2x: IMG_2X_HEIGHT,
    width1x: IMG_1X_WIDTH,
    height1x: IMG_1X_HEIGHT,
    bytes2x: 1000,
  }

  it('passes a healthy artifact', () => {
    expect(() => assertWorldArtifact(base)).not.toThrow()
  })

  it('fails on fewer than 6 labels', () => {
    expect(() => assertWorldArtifact({ ...base, labels: labels.slice(0, 5) })).toThrow(/labels 5 < 6/)
  })

  it('fails when a label falls outside the image bounds (wraparound-aware)', () => {
    const outOfRange = [...labels]
    outOfRange[0] = { ...outOfRange[0]!, lng: -30 } // 大西洋空档
    expect(() => assertWorldArtifact({ ...base, labels: outOfRange })).toThrow(/k0 lng -30 out of bounds/)

    const tooNorth = labels.map((label, i) =>
      i === 1 ? { ...label, lat: 80 } : label
    )
    expect(() => assertWorldArtifact({ ...base, labels: tooNorth })).toThrow(/k1 lat 80 out of bounds/)
  })

  it('fails on wrong dimensions or an over-budget 2x image', () => {
    expect(() => assertWorldArtifact({ ...base, width2x: 2415 })).toThrow(/2x image is 2415x882/)
    expect(() => assertWorldArtifact({ ...base, width1x: 1207 })).toThrow(/1x image is 1207x/)
    expect(() =>
      assertWorldArtifact({ ...base, bytes2x: IMAGE_2X_MAX_BYTES + 1 })
    ).toThrow(/bytes \(budget /)
  })
})
