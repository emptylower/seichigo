import { describe, expect, it } from 'vitest'
import {
  estimateMapLabelWidth,
  formatRoundedTotal,
  mapDbSubtitle,
  mapLabelRect,
  placeMapLabels,
  rectsOverlap,
  roundDownToThousands,
  zoomForWidth,
} from '@/components/home/homeMapDatabaseUtils'

describe('roundDownToThousands / formatRoundedTotal', () => {
  it('向下取整到千位：50597 → 50000，千分位按 locale 格式化', () => {
    expect(roundDownToThousands(50597)).toBe(50000)
    expect(roundDownToThousands(999)).toBe(0)
    expect(roundDownToThousands(1000)).toBe(1000)
    expect(formatRoundedTotal(50597, 'zh')).toBe('50,000')
    expect(formatRoundedTotal(50597, 'en')).toBe('50,000')
    expect(formatRoundedTotal(50597, 'ja')).toBe('50,000')
  })

  it('脏数据兜底：负数/NaN/Infinity 都归 0，绝不把奇怪数字渲染出去', () => {
    expect(roundDownToThousands(-5)).toBe(0)
    expect(roundDownToThousands(Number.NaN)).toBe(0)
    expect(roundDownToThousands(Number.POSITIVE_INFINITY)).toBe(0)
    expect(formatRoundedTotal(-5, 'zh')).toBe('0')
  })
})

describe('mapDbSubtitle', () => {
  it('有 stats 时替换 {works} 占位（数字千分位），不再出现城市数', () => {
    expect(mapDbSubtitle('zh', { works: 1234 })).toBe('来自 1,234 部动漫作品 · 每天都在增加')
    expect(mapDbSubtitle('en', { works: 1234 })).toContain('1,234 anime series')
    expect(mapDbSubtitle('ja', { works: 1234 })).toContain('1,234 作品から')
  })

  it('stats 缺失或 works 为 0 时只保留「每天都在增加」小节，不漏占位符', () => {
    expect(mapDbSubtitle('zh', null)).toBe('每天都在增加')
    expect(mapDbSubtitle('zh', undefined)).toBe('每天都在增加')
    expect(mapDbSubtitle('zh', { works: 0 })).toBe('每天都在增加')
    expect(mapDbSubtitle('en', null)).toBe('Growing every day')
    expect(mapDbSubtitle('ja', null)).toBe('毎日増えています')
  })
})

describe('zoomForWidth', () => {
  it('log2(width/256)+0.08、下限 1.2：世界略宽于容器正好铺满，桌面 1150px 约 2.25', () => {
    expect(zoomForWidth(256)).toBe(1.2)
    expect(zoomForWidth(320)).toBe(1.2)
    expect(zoomForWidth(1024)).toBe(2.08)
    expect(zoomForWidth(1150)).toBe(2.25)
    // 无上限：更宽的容器需要更高 zoom 才能铺满
    expect(zoomForWidth(2000)).toBeGreaterThan(zoomForWidth(1150))
  })

  it('容器宽度读不到（0/NaN）时按 960 给默认值', () => {
    const fallback = zoomForWidth(0)
    expect(fallback).toBe(zoomForWidth(960))
    expect(fallback).toBeGreaterThan(1.9)
    expect(fallback).toBeLessThan(2.1)
    expect(zoomForWidth(Number.NaN)).toBe(fallback)
  })
})

describe('城市标签碰撞规避', () => {
  it('估计宽度：CJK 全角比 ASCII 宽', () => {
    expect(estimateMapLabelWidth('东京 4,210')).toBeGreaterThan(estimateMapLabelWidth('Tokyo 4,210') - 30)
    expect(estimateMapLabelWidth('東京')).toBeGreaterThan(estimateMapLabelWidth('ab'))
  })

  it('rectsOverlap：相交判定', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 }
    expect(rectsOverlap(a, { left: 5, top: 5, right: 15, bottom: 15 })).toBe(true)
    expect(rectsOverlap(a, { left: 20, top: 0, right: 30, bottom: 10 })).toBe(false)
    expect(rectsOverlap(a, { left: 0, top: 20, right: 10, bottom: 30 })).toBe(false)
  })

  it('按输入顺序（count 降序）先到先得，相交的跳过', () => {
    const placed = placeMapLabels([
      { key: 'tokyo', x: 100, y: 100, width: 80 },
      { key: 'overlap', x: 110, y: 105, width: 80 },
      { key: 'far', x: 400, y: 100, width: 80 },
    ])
    expect(placed.map((p) => p.key)).toEqual(['tokyo', 'far'])
  })

  it('标签矩形锚在点位上方、水平居中（留出 MAP_LABEL_GAP）', () => {
    const rect = mapLabelRect(100, 100, 80, 26)
    expect((rect.left + rect.right) / 2).toBe(100)
    expect(rect.bottom).toBeLessThan(100)
    expect(rect.bottom).toBe(100 - 8)
    expect(rect.top).toBe(100 - 8 - 26)
  })

  it('全部重叠时只保留第一个', () => {
    const placed = placeMapLabels([
      { key: 'a', x: 0, y: 0, width: 100 },
      { key: 'b', x: 10, y: 0, width: 100 },
      { key: 'c', x: 20, y: 0, width: 100 },
    ])
    expect(placed.map((p) => p.key)).toEqual(['a'])
  })
})
