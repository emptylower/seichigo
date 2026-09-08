import { describe, expect, it } from 'vitest'
import {
  CAPSULE_METRICS,
  CARD_FOOTER_SIZES,
  CARD_ROW_METRICS,
  GEO_FONT_STACK,
  addressPinMetrics,
  buildCapsuleMiddle,
  buildCapsuleMiddleRows,
  buildCardLayout,
  buildCardTextPlan,
  computeCoverRect,
  formatGeoLine,
  gpsIconMetrics,
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
  it('default：主视觉 640 高，文字块上边距 36，导航胶囊锚底部', () => {
    const layout = buildCardLayout('portrait', 'default')
    expect(layout.canvas).toEqual({ width: 1080, height: 1440 })
    expect(layout.main).toEqual({ x: 0, y: 0, width: 1080, height: 640 })
    expect(layout.photo).toBeNull()
    expect(layout.textTop).toBe(676)
    expect(layout.textX).toBe(64)
    // 文字区占满页宽，胶囊横贯底部
    expect(layout.textWidth).toBe(952)
    expect(layout.capsule).toEqual({ x: 64, y: 1116, width: 952, height: 228 })
    expect(layout.locator).toEqual({ x: 92, y: 1140, width: 180, height: 180 })
    expect(layout.qr).toEqual({ x: 808, y: 1140, size: 180 })
    expect(layout.footerX).toBe(64)
    expect(layout.footerY).toBe(1398)
    expect(layout.footerRightX).toBe(1016)
  })

  it('compare：上下两张图各 320 高', () => {
    const layout = buildCardLayout('portrait', 'compare')
    expect(layout.main).toEqual({ x: 0, y: 0, width: 1080, height: 320 })
    expect(layout.photo).toEqual({ x: 0, y: 320, width: 1080, height: 320 })
  })

  it('几何硬约束：胶囊底 + 24 + 页脚行高 ≤ 1440 - 36', () => {
    const layout = buildCardLayout('portrait', 'default')
    const bottom = layout.capsule.y + layout.capsule.height
    expect(bottom + 24 + CARD_FOOTER_SIZES.portrait * 1.2).toBeLessThanOrEqual(1440 - 36)
    expect(layout.footerY).toBeLessThanOrEqual(1440 - 36 + CARD_FOOTER_SIZES.portrait * 0.2)
  })
})

describe('buildCardLayout 横版', () => {
  it('default：左 640 是图，文字/胶囊/页脚全在右列', () => {
    const layout = buildCardLayout('landscape', 'default')
    expect(layout.canvas).toEqual({ width: 1200, height: 630 })
    expect(layout.main).toEqual({ x: 0, y: 0, width: 640, height: 630 })
    expect(layout.photo).toBeNull()
    expect(layout.textTop).toBe(34)
    expect(layout.textX).toBe(672)
    expect(layout.textWidth).toBe(492)
    expect(layout.capsule).toEqual({ x: 672, y: 452, width: 492, height: 128 })
    expect(layout.locator).toEqual({ x: 688, y: 466, width: 100, height: 100 })
    expect(layout.qr).toEqual({ x: 1048, y: 466, size: 100 })
    // 页脚不能压在左侧图片上
    expect(layout.footerX).toBe(672)
    expect(layout.footerY).toBe(616)
    expect(layout.footerRightX).toBe(1164)
  })

  it('compare：左半区再对半分给截图与实拍', () => {
    const layout = buildCardLayout('landscape', 'compare')
    expect(layout.main).toEqual({ x: 0, y: 0, width: 320, height: 630 })
    expect(layout.photo).toEqual({ x: 320, y: 0, width: 320, height: 630 })
  })
})

describe('导航胶囊几何', () => {
  it.each(['portrait', 'landscape'] as const)('%s：胶囊整体在画布内且在页脚之上', (l) => {
    const layout = buildCardLayout(l, 'default')
    const c = layout.capsule
    expect(c.x).toBeGreaterThanOrEqual(0)
    expect(c.y).toBeGreaterThanOrEqual(0)
    expect(c.x + c.width).toBeLessThanOrEqual(layout.canvas.width)
    const footerTop = layout.footerY - CARD_FOOTER_SIZES[l]
    expect(c.y + c.height).toBeLessThanOrEqual(footerTop)
    expect(layout.footerY).toBeLessThanOrEqual(layout.canvas.height)
  })

  it.each(['portrait', 'landscape'] as const)('%s：轮廓与二维码落在胶囊内容区内，横向不撞', (l) => {
    const layout = buildCardLayout(l, 'default')
    const c = layout.capsule
    const m = CAPSULE_METRICS[l]
    const inner = { x0: c.x + m.padH, x1: c.x + c.width - m.padH, y0: c.y + m.padV, y1: c.y + c.height - m.padV }
    // 轮廓贴内容区左缘，二维码贴右缘，都垂直居中于内容区
    expect(layout.locator.x).toBe(inner.x0)
    expect(layout.locator.y).toBeGreaterThanOrEqual(inner.y0)
    expect(layout.locator.y + layout.locator.height).toBeLessThanOrEqual(inner.y1)
    expect(layout.qr.x + layout.qr.size).toBe(inner.x1)
    expect(layout.qr.y).toBeGreaterThanOrEqual(inner.y0)
    expect(layout.qr.y + layout.qr.size).toBeLessThanOrEqual(inner.y1)
    expect(layout.locator.x + layout.locator.width + m.gap).toBeLessThanOrEqual(layout.qr.x - m.gap)
  })

  it.each(['portrait', 'landscape'] as const)('%s：中列在轮廓与二维码之间，inJapan=false 时贴胶囊左缘', (l) => {
    const layout = buildCardLayout(l, 'default')
    const m = CAPSULE_METRICS[l]
    const withOutline = buildCapsuleMiddle(layout, true)
    expect(withOutline.x).toBe(layout.locator.x + layout.locator.width + m.gap)
    expect(withOutline.x + withOutline.width).toBe(layout.qr.x - m.gap)
    expect(withOutline.width).toBeGreaterThan(0)
    const withoutOutline = buildCapsuleMiddle(layout, false)
    expect(withoutOutline.x).toBe(layout.capsule.x + m.padH)
    expect(withoutOutline.x + withoutOutline.width).toBe(layout.qr.x - m.gap)
    // 中列纵向就是内容区
    expect(withOutline.y).toBe(layout.capsule.y + m.padV)
    expect(withOutline.height).toBe(layout.capsule.height - m.padV * 2)
  })

  it.each(['portrait', 'landscape'] as const)('%s：有坐标时中列三行垂直居中，顺序 标题/坐标/副标题', (l) => {
    const layout = buildCardLayout(l, 'default')
    const middle = buildCapsuleMiddle(layout, true)
    const rows = buildCapsuleMiddleRows(l, middle, true)
    const m = CAPSULE_METRICS[l]
    expect(rows.title.size).toBe(m.titleSize)
    expect(rows.coord?.size).toBe(m.coordSize)
    expect(rows.sub.size).toBe(m.subSize)
    expect(rows.coord!.y).toBeGreaterThan(rows.title.y)
    expect(rows.sub.y).toBeGreaterThan(rows.coord!.y)
    // 三行整体在内容区内垂直居中（标题顶距 == 副标题底距）
    const topPad = rows.title.y - middle.y
    const bottomPad = middle.y + middle.height - (rows.sub.y + rows.sub.size)
    expect(Math.abs(topPad - bottomPad)).toBeLessThanOrEqual(0.5)
  })

  it.each(['portrait', 'landscape'] as const)('%s：无坐标时中列只有两行，仍垂直居中', (l) => {
    const layout = buildCardLayout(l, 'default')
    const middle = buildCapsuleMiddle(layout, true)
    const rows = buildCapsuleMiddleRows(l, middle, false)
    expect(rows.coord).toBeNull()
    const topPad = rows.title.y - middle.y
    const bottomPad = middle.y + middle.height - (rows.sub.y + rows.sub.size)
    expect(Math.abs(topPad - bottomPad)).toBeLessThanOrEqual(0.5)
  })

  it('二维码白卡内缩后仍在胶囊内', () => {
    const layout = buildCardLayout('landscape', 'default')
    const m = CAPSULE_METRICS.landscape
    const imageSize = layout.qr.size - m.qrPad * 2
    expect(imageSize).toBeGreaterThan(0)
    expect(layout.qr.x + m.qrPad + imageSize).toBeLessThanOrEqual(layout.capsule.x + layout.capsule.width)
  })
})

describe('addressPinMetrics', () => {
  it('图钉宽度与右侧留白都按字号等比，offset 是两者之和', () => {
    const m = addressPinMetrics(34)
    expect(m.width).toBeCloseTo(34 * 0.62, 6)
    expect(m.gap).toBeCloseTo(34 * 0.28, 6)
    expect(m.offset).toBeCloseTo(m.width + m.gap, 6)
  })

  it('字号越大图钉越大，且始终窄于一个字', () => {
    expect(addressPinMetrics(24).width).toBeLessThan(addressPinMetrics(34).width)
    expect(addressPinMetrics(34).width).toBeLessThan(34)
  })
})

describe('CARD_ROW_METRICS', () => {
  it('竖版说明行行距给到 12，两行说明不至于贴在一起', () => {
    expect(CARD_ROW_METRICS.portrait.note.gap).toBe(12)
  })

  it('v2.1 横版：作品行 26px，说明最多 2 行', () => {
    expect(CARD_ROW_METRICS.landscape.anime.size).toBe(26)
    expect(CARD_ROW_METRICS.landscape.note.maxLines).toBe(2)
  })

  it.each(['portrait', 'landscape'] as const)('%s：文字块右边界不越画布', (l) => {
    const layout = buildCardLayout(l, 'default')
    expect(layout.textX + layout.textWidth).toBeLessThanOrEqual(layout.canvas.width)
  })
})

// 2026-09-08 分享卡片 v2.1：坐标行进胶囊（C1）
describe('formatGeoLine', () => {
  it('纬度在前、经度在后，各保留 4 位小数，逗号后一个空格', () => {
    expect(formatGeoLine([35.7, 139.56])).toBe('35.7000, 139.5600')
  })

  it('负坐标带负号，不足 4 位补零', () => {
    expect(formatGeoLine([-33.8688, 151.2093])).toBe('-33.8688, 151.2093')
  })

  it('超过 4 位的部分四舍五入', () => {
    expect(formatGeoLine([35.65804, 139.70166])).toBe('35.6580, 139.7017')
  })
})

describe('GEO_FONT_STACK', () => {
  it('坐标行用等宽字体栈', () => {
    expect(GEO_FONT_STACK).toBe('ui-monospace, SFMono-Regular, Menlo, monospace')
  })
})

describe('gpsIconMetrics', () => {
  it('图标边长等于字号，offset 是图标加右侧留白', () => {
    const m = gpsIconMetrics(19)
    expect(m.size).toBe(19)
    expect(m.offset).toBeCloseTo(m.size + m.gap, 6)
    expect(m.gap).toBeGreaterThan(0)
  })

  it('offset 随字号等比放大', () => {
    expect(gpsIconMetrics(28).offset).toBeGreaterThan(gpsIconMetrics(19).offset)
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
      addressLine: '東京都 武蔵野市 中町一丁目',
      noteLines: Array.from({ length: metrics.note.maxLines }, (_, i) => `说明${i}`),
    }
  }

  it.each(['portrait', 'landscape'] as const)('%s：满行内容仍然全部在胶囊之上', (l) => {
    const plan = buildCardTextPlan(fullRows(l))
    expect(plan.rows.length).toBe(
      CARD_ROW_METRICS[l].name.maxLines + 1 + 1 + CARD_ROW_METRICS[l].note.maxLines,
    )
    // 实际字形高度约字号的 1.2 倍，按这个量算最后一行的底边
    const last = plan.rows[plan.rows.length - 1]!
    expect(last.y + last.size * 1.2).toBeLessThanOrEqual(buildCardLayout(l, 'default').capsule.y)
  })

  it('行从 textTop 开始，按各行字号与间距逐行下移', () => {
    const geometry = buildCardLayout('portrait', 'default')
    const metrics = CARD_ROW_METRICS.portrait
    const plan = buildCardTextPlan({
      layout: 'portrait',
      geometry,
      nameLines: ['葡萄牛奶'],
      animeLine: '《摇曳露营△ 三期》',
      addressLine: '東京都 武蔵野市',
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
