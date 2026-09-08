import { describe, expect, it } from 'vitest'
import { JAPAN_OUTLINE, projectToBox } from '@/components/share/japanLocator'

const BOX = { x: 0, y: 0, width: 260, height: 260 }
const BBOX = JAPAN_OUTLINE.bbox

describe('JAPAN_OUTLINE', () => {
  it('入库的轮廓有 bbox 与多环', () => {
    expect(BBOX).toEqual([123.68, 24.266, 145.833, 45.51])
    expect(JAPAN_OUTLINE.rings.length).toBeGreaterThan(10)
  })
})

describe('projectToBox', () => {
  const [minLon, minLat, maxLon, maxLat] = BBOX

  it('bbox 四角都落在目标框之内', () => {
    for (const [lon, lat] of [
      [minLon, minLat],
      [minLon, maxLat],
      [maxLon, minLat],
      [maxLon, maxLat],
    ] as const) {
      const p = projectToBox(lon, lat, BOX, BBOX)
      expect(p.x).toBeGreaterThanOrEqual(BOX.x - 1e-6)
      expect(p.x).toBeLessThanOrEqual(BOX.x + BOX.width + 1e-6)
      expect(p.y).toBeGreaterThanOrEqual(BOX.y - 1e-6)
      expect(p.y).toBeLessThanOrEqual(BOX.y + BOX.height + 1e-6)
    }
  })

  it('西南角在左下、东北角在右上（y 轴向下翻转）', () => {
    const sw = projectToBox(minLon, minLat, BOX, BBOX)
    const ne = projectToBox(maxLon, maxLat, BOX, BBOX)
    expect(ne.x).toBeGreaterThan(sw.x)
    expect(ne.y).toBeLessThan(sw.y)
    // 纬度方向撑满（span 更「高」），经度方向留白居中
    expect(sw.y).toBeCloseTo(BOX.y + BOX.height, 6)
    expect(ne.y).toBeCloseTo(BOX.y, 6)
    expect(sw.x).toBeGreaterThan(BOX.x)
  })

  it('cos(平均纬度) 修正让经度方向被压窄，而不是各自撑满', () => {
    const sw = projectToBox(minLon, minLat, BOX, BBOX)
    const se = projectToBox(maxLon, minLat, BOX, BBOX)
    const drawnWidth = se.x - sw.x
    expect(drawnWidth).toBeLessThan(BOX.width)
    expect(drawnWidth).toBeGreaterThan(BOX.width * 0.8)
    // 左右留白等宽
    expect(sw.x - BOX.x).toBeCloseTo(BOX.x + BOX.width - se.x, 6)
  })

  it('东京落在轮廓框右侧偏下', () => {
    const p = projectToBox(139.7, 35.68, BOX, BBOX)
    expect(p.x / BOX.width).toBeGreaterThan(0.6)
    expect(p.y / BOX.height).toBeGreaterThan(0.45)
    expect(p.y / BOX.height).toBeLessThan(0.7)
  })

  it('框有偏移时整体平移', () => {
    const shifted = projectToBox(139.7, 35.68, { x: 100, y: 50, width: 260, height: 260 }, BBOX)
    const origin = projectToBox(139.7, 35.68, BOX, BBOX)
    expect(shifted.x).toBeCloseTo(origin.x + 100, 6)
    expect(shifted.y).toBeCloseTo(origin.y + 50, 6)
  })
})
