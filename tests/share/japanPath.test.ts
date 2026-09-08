import { describe, expect, it } from 'vitest'
import {
  buildJapanOutlinePath,
  buildJapanProjection,
  projectJapanLatLng,
} from '@/lib/share/japanPath'
import { JAPAN_BBOX } from '@/lib/share/types'

const BOX = { width: 180, height: 180 }

describe('buildJapanProjection / projectJapanLatLng', () => {
  it('bbox 四角都落在框内', () => {
    const [minLon, minLat, maxLon, maxLat] = JAPAN_BBOX
    for (const [lat, lng] of [
      [minLat, minLon],
      [minLat, maxLon],
      [maxLat, minLon],
      [maxLat, maxLon],
    ] as const) {
      const point = projectJapanLatLng(BOX, lat, lng)
      expect(point.x).toBeGreaterThanOrEqual(-0.001)
      expect(point.x).toBeLessThanOrEqual(BOX.width + 0.001)
      expect(point.y).toBeGreaterThanOrEqual(-0.001)
      expect(point.y).toBeLessThanOrEqual(BOX.height + 0.001)
    }
  })

  it('等比缩放：短边贴满，长边居中留白', () => {
    const [minLon, minLat, maxLon, maxLat] = JAPAN_BBOX
    const topLeft = projectJapanLatLng(BOX, maxLat, minLon)
    const bottomRight = projectJapanLatLng(BOX, minLat, maxLon)
    const usedWidth = bottomRight.x - topLeft.x
    const usedHeight = bottomRight.y - topLeft.y
    // 至少一个方向铺满整框（浮点容差 0.001）
    expect(
      Math.abs(usedWidth - BOX.width) < 0.001 || Math.abs(usedHeight - BOX.height) < 0.001,
    ).toBe(true)
    // 留白两侧对称
    expect(topLeft.x).toBeCloseTo(BOX.width - bottomRight.x, 6)
    expect(topLeft.y).toBeCloseTo(BOX.height - bottomRight.y, 6)
  })

  it('东京 / 京都 / 札幌的相对位置正确（东京在京都之东、札幌之南）', () => {
    const tokyo = projectJapanLatLng(BOX, 35.6895, 139.6917)
    const kyoto = projectJapanLatLng(BOX, 35.0116, 135.7681)
    const sapporo = projectJapanLatLng(BOX, 43.0618, 141.3545)
    expect(tokyo.x).toBeGreaterThan(kyoto.x)
    expect(tokyo.y).toBeGreaterThan(sapporo.y)
    for (const point of [tokyo, kyoto, sapporo]) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
  })

  it('投影只依赖框尺寸，重复调用结果稳定', () => {
    const a = buildJapanProjection(BOX)
    const b = buildJapanProjection(BOX)
    expect(a).toEqual(b)
  })
})

describe('buildJapanOutlinePath', () => {
  const d = buildJapanOutlinePath(BOX)

  it('以 M 开头、以 Z 结尾，且没有 NaN', () => {
    expect(d.startsWith('M')).toBe(true)
    expect(d.trimEnd().endsWith('Z')).toBe(true)
    expect(d).not.toContain('NaN')
  })

  it('环数与数据一致（34 个子路径）', () => {
    expect(d.split('Z').filter((part) => part.trim()).length).toBe(34)
  })

  it('坐标保留两位小数，串长可控', () => {
    expect(d).not.toMatch(/\d\.\d{3,}/)
    expect(d.length).toBeGreaterThan(1000)
  })
})
