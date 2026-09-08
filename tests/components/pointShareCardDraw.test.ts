import { describe, expect, it } from 'vitest'
import {
  buildCardLayout,
  computeCoverRect,
  resolveCardVariant,
  wrapLines,
} from '@/components/share/pointShareCardDraw'

describe('computeCoverRect', () => {
  it('图更宽时左右裁切', () => {
    expect(computeCoverRect(2000, 1000, 1000, 1000)).toEqual({ sx: 500, sy: 0, sw: 1000, sh: 1000 })
  })

  it('图更高时上下裁切', () => {
    expect(computeCoverRect(1000, 2000, 1000, 1000)).toEqual({ sx: 0, sy: 500, sw: 1000, sh: 1000 })
  })

  it('比例一致时不裁', () => {
    expect(computeCoverRect(800, 600, 400, 300)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 600 })
  })
})

describe('wrapLines', () => {
  // 每个字符宽 10 的假测量器
  const measure = (text: string) => text.length * 10

  it('按宽度断行', () => {
    expect(wrapLines(measure, '一二三四五六', 30, 5)).toEqual(['一二三', '四五六'])
  })

  it('超出行数时最后一行加省略号', () => {
    expect(wrapLines(measure, '一二三四五六七八九', 30, 2)).toEqual(['一二三', '四五…'])
  })

  it('空串返回空数组', () => {
    expect(wrapLines(measure, '   ', 100, 2)).toEqual([])
  })
})

describe('resolveCardVariant', () => {
  it('有实拍才是 compare', () => {
    expect(resolveCardVariant(true)).toBe('compare')
    expect(resolveCardVariant(false)).toBe('default')
  })
})

describe('buildCardLayout', () => {
  it('竖版 default：主视觉占上半，文字块在下', () => {
    const layout = buildCardLayout('portrait', 'default')
    expect(layout.canvas).toEqual({ width: 1080, height: 1440 })
    expect(layout.main).toEqual({ x: 0, y: 0, width: 1080, height: 1000 })
    expect(layout.photo).toBeNull()
    expect(layout.textTop).toBe(1060)
    expect(layout.qr).toEqual({ x: 840, y: 1140, size: 180 })
  })

  it('竖版 compare：上下两张图各占一半', () => {
    const layout = buildCardLayout('portrait', 'compare')
    expect(layout.main).toEqual({ x: 0, y: 0, width: 1080, height: 500 })
    expect(layout.photo).toEqual({ x: 0, y: 500, width: 1080, height: 500 })
  })

  it('横版 compare：左右两张图各占一半', () => {
    const layout = buildCardLayout('landscape', 'compare')
    expect(layout.canvas).toEqual({ width: 1200, height: 630 })
    expect(layout.main).toEqual({ x: 0, y: 0, width: 600, height: 430 })
    expect(layout.photo).toEqual({ x: 600, y: 0, width: 600, height: 430 })
  })
})
