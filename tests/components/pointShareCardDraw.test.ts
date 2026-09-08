import { describe, expect, it } from 'vitest'
import {
  CARD_FOOTER_SIZES,
  CARD_ROW_METRICS,
  buildCardLayout,
  buildCardTextPlan,
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

describe('buildCardLayout 竖版', () => {
  it('default：主视觉 720 高，文字块与轮廓/二维码带各就各位', () => {
    const layout = buildCardLayout('portrait', 'default')
    expect(layout.canvas).toEqual({ width: 1080, height: 1440 })
    expect(layout.main).toEqual({ x: 0, y: 0, width: 1080, height: 720 })
    expect(layout.photo).toBeNull()
    expect(layout.textTop).toBe(768)
    expect(layout.textX).toBe(64)
    // 轮廓与二维码换到底部横带，文字不再需要给二维码让出宽度
    expect(layout.textWidth).toBe(952)
    expect(layout.locator).toEqual({ x: 64, y: 1096, width: 240, height: 240 })
    expect(layout.qr).toEqual({ x: 836, y: 1126, size: 180 })
    expect(layout.footerX).toBe(64)
    expect(layout.footerY).toBe(1380)
  })

  it('compare：上下两张图各占主视觉一半', () => {
    const layout = buildCardLayout('portrait', 'compare')
    expect(layout.main).toEqual({ x: 0, y: 0, width: 1080, height: 360 })
    expect(layout.photo).toEqual({ x: 0, y: 360, width: 1080, height: 360 })
  })
})

describe('buildCardLayout 横版', () => {
  it('default：左 55% 是图，文字/轮廓/二维码/页脚全在右列', () => {
    const layout = buildCardLayout('landscape', 'default')
    expect(layout.canvas).toEqual({ width: 1200, height: 630 })
    expect(layout.main).toEqual({ x: 0, y: 0, width: 660, height: 630 })
    expect(layout.photo).toBeNull()
    expect(layout.textTop).toBe(48)
    expect(layout.textX).toBe(692)
    expect(layout.textWidth).toBe(468)
    expect(layout.locator).toEqual({ x: 692, y: 434, width: 150, height: 150 })
    expect(layout.qr).toEqual({ x: 1050, y: 474, size: 110 })
    // 页脚不能压在左侧图片上
    expect(layout.footerX).toBe(692)
    expect(layout.footerY).toBe(616)
  })

  it('compare：左半区再对半分给截图与实拍', () => {
    const layout = buildCardLayout('landscape', 'compare')
    expect(layout.main).toEqual({ x: 0, y: 0, width: 330, height: 630 })
    expect(layout.photo).toEqual({ x: 330, y: 0, width: 330, height: 630 })
  })
})

describe('卡片几何不重叠', () => {
  it.each(['portrait', 'landscape'] as const)('%s：轮廓与二维码都在页脚之上', (l) => {
    const layout = buildCardLayout(l, 'default')
    const footerTop = layout.footerY - CARD_FOOTER_SIZES[l]
    expect(layout.locator.y + layout.locator.height).toBeLessThanOrEqual(footerTop)
    expect(layout.qr.y + layout.qr.size).toBeLessThanOrEqual(footerTop)
    expect(layout.footerY).toBeLessThanOrEqual(layout.canvas.height)
  })

  it.each(['portrait', 'landscape'] as const)('%s：轮廓与二维码横向不相撞', (l) => {
    const layout = buildCardLayout(l, 'default')
    expect(layout.locator.x + layout.locator.width).toBeLessThanOrEqual(layout.qr.x)
    expect(layout.qr.x + layout.qr.size).toBeLessThanOrEqual(layout.canvas.width)
  })

  it.each(['portrait', 'landscape'] as const)('%s：文字块右边界不越画布', (l) => {
    const layout = buildCardLayout(l, 'default')
    expect(layout.textX + layout.textWidth).toBeLessThanOrEqual(layout.canvas.width)
  })
})

describe('buildCardTextPlan', () => {
  const fullRows = (l: 'portrait' | 'landscape') => {
    const metrics = CARD_ROW_METRICS[l]
    return {
      layout: l,
      geometry: buildCardLayout(l, 'default'),
      nameLines: Array.from({ length: metrics.name.maxLines }, (_, i) => `名字${i}`),
      animeLine: '《摇曳露营△ 三期》 · 第 1 集 · 19:54',
      addressLine: '📍 東京都 武蔵野市 中町一丁目',
      noteLines: Array.from({ length: metrics.note.maxLines }, (_, i) => `说明${i}`),
    }
  }

  it.each(['portrait', 'landscape'] as const)('%s：满行内容仍然全部在轮廓带之上', (l) => {
    const plan = buildCardTextPlan(fullRows(l))
    expect(plan.rows.length).toBe(
      CARD_ROW_METRICS[l].name.maxLines + 1 + 1 + CARD_ROW_METRICS[l].note.maxLines,
    )
    expect(plan.bottom).toBeLessThanOrEqual(buildCardLayout(l, 'default').locator.y)
  })

  it('行从 textTop 开始，按各行字号与间距逐行下移', () => {
    const geometry = buildCardLayout('portrait', 'default')
    const metrics = CARD_ROW_METRICS.portrait
    const plan = buildCardTextPlan({
      layout: 'portrait',
      geometry,
      nameLines: ['葡萄牛奶'],
      animeLine: '《摇曳露营△ 三期》',
      addressLine: '📍 東京都 武蔵野市',
      noteLines: ['联名饮品'],
    })
    expect(plan.rows.map((row) => row.kind)).toEqual(['name', 'anime', 'address', 'note'])
    expect(plan.rows[0]!.y).toBe(geometry.textTop)
    expect(plan.rows[1]!.y).toBe(geometry.textTop + metrics.name.size + metrics.name.gap)
    expect(plan.rows[0]!.size).toBe(metrics.name.size)
    expect(plan.rows[3]!.size).toBe(metrics.note.size)
  })

  it('缺地址与说明时后面的行直接上移，不留空档', () => {
    const geometry = buildCardLayout('portrait', 'default')
    const metrics = CARD_ROW_METRICS.portrait
    const plan = buildCardTextPlan({
      layout: 'portrait',
      geometry,
      nameLines: ['葡萄牛奶'],
      animeLine: '《摇曳露营△ 三期》',
      addressLine: '',
      noteLines: [],
    })
    expect(plan.rows.map((row) => row.kind)).toEqual(['name', 'anime'])
    expect(plan.bottom).toBe(geometry.textTop + metrics.name.size + metrics.name.gap + metrics.anime.size)
  })

  it('一行都没有时 bottom 等于 textTop', () => {
    const geometry = buildCardLayout('landscape', 'default')
    const plan = buildCardTextPlan({
      layout: 'landscape',
      geometry,
      nameLines: [],
      animeLine: '',
      addressLine: '',
      noteLines: [],
    })
    expect(plan.rows).toEqual([])
    expect(plan.bottom).toBe(geometry.textTop)
  })
})
