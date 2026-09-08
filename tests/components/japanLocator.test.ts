import { describe, expect, it } from 'vitest'
import {
  JAPAN_OUTLINE,
  LOCATOR_COLORS,
  drawJapanLocator,
  projectToBox,
  type LocatorContext,
  type LocatorGeometry,
} from '@/components/share/japanLocator'

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

type Call = [string, ...unknown[]]

function makeCtx() {
  const calls: Call[] = []
  const styles: string[] = []
  const ctx = {
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    closePath: () => calls.push(['closePath']),
    moveTo: (x: number, y: number) => calls.push(['moveTo', x, y]),
    lineTo: (x: number, y: number) => calls.push(['lineTo', x, y]),
    fill: () => calls.push(['fill']),
    stroke: () => calls.push(['stroke']),
    arc: (x: number, y: number, r: number) => calls.push(['arc', x, y, r]),
    set fillStyle(value: string) {
      styles.push(value)
      calls.push(['fillStyle', value])
    },
    set strokeStyle(value: string) {
      calls.push(['strokeStyle', value])
    },
    set lineWidth(value: number) {
      calls.push(['lineWidth', value])
    },
  }
  return { ctx: ctx as unknown as LocatorContext, calls, styles }
}

/** 一个正方形单环的假几何，投影结果好算 */
const SQUARE: LocatorGeometry = {
  bbox: [0, 0, 10, 10],
  rings: [[[0, 0], [10, 0], [10, 10], [0, 10]]],
}

describe('drawJapanLocator', () => {
  const BOX2 = { x: 0, y: 0, width: 100, height: 100 }

  it('每个环走 beginPath → moveTo → lineTo* → closePath → fill → stroke', () => {
    const { ctx, calls } = makeCtx()
    drawJapanLocator(ctx, BOX2, null, SQUARE)
    const names = calls.map((c) => c[0])
    expect(names.filter((n) => n === 'beginPath')).toHaveLength(1)
    expect(names.filter((n) => n === 'moveTo')).toHaveLength(1)
    expect(names.filter((n) => n === 'lineTo')).toHaveLength(3)
    expect(names).toContain('closePath')
    expect(names).toContain('fill')
    expect(names).toContain('stroke')
    expect(names[0]).toBe('save')
    expect(names[names.length - 1]).toBe('restore')
  })

  it('用 spec 指定的填充/描边/定位点颜色', () => {
    const { ctx, calls, styles } = makeCtx()
    drawJapanLocator(ctx, BOX2, { lat: 5, lng: 5 }, SQUARE)
    expect(LOCATOR_COLORS).toEqual({ fill: '#fbcfe8', stroke: '#ec4899', marker: '#db2777' })
    expect(styles[0]).toBe('#fbcfe8')
    expect(calls).toContainEqual(['strokeStyle', '#ec4899'])
    expect(styles).toContain('#db2777')
  })

  it('传了 point 才画圆，圆心是投影后的坐标', () => {
    const { ctx, calls } = makeCtx()
    drawJapanLocator(ctx, BOX2, { lat: 5, lng: 5 }, SQUARE)
    const arc = calls.find((c) => c[0] === 'arc')!
    const expected = projectToBox(5, 5, BOX2, SQUARE.bbox)
    expect(arc[1]).toBeCloseTo(expected.x, 6)
    expect(arc[2]).toBeCloseTo(expected.y, 6)
    expect(arc[3] as number).toBeGreaterThanOrEqual(3)
  })

  it('point 为 null 时不画圆', () => {
    const { ctx, calls } = makeCtx()
    drawJapanLocator(ctx, BOX2, null, SQUARE)
    expect(calls.find((c) => c[0] === 'arc')).toBeUndefined()
  })

  it('点数不足 3 的环被跳过', () => {
    const { ctx, calls } = makeCtx()
    drawJapanLocator(ctx, BOX2, null, { bbox: [0, 0, 10, 10], rings: [[[1, 1], [2, 2]]] })
    expect(calls.filter((c) => c[0] === 'beginPath')).toHaveLength(0)
  })

  it('真实日本轮廓全部落在框内', () => {
    const { ctx, calls } = makeCtx()
    const box = { x: 20, y: 30, width: 240, height: 240 }
    drawJapanLocator(ctx, box, { lat: 35.68, lng: 139.7 })
    const points = calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')
    expect(points.length).toBeGreaterThan(1000)
    for (const [, x, y] of points as Array<[string, number, number]>) {
      expect(x).toBeGreaterThanOrEqual(box.x - 1e-6)
      expect(x).toBeLessThanOrEqual(box.x + box.width + 1e-6)
      expect(y).toBeGreaterThanOrEqual(box.y - 1e-6)
      expect(y).toBeLessThanOrEqual(box.y + box.height + 1e-6)
    }
  })
})
