import { SHARE_CARD_SIZES, type ShareCardLayout, type ShareCardVariant } from '@/lib/share/types'

export type Rect = { x: number; y: number; width: number; height: number }
export type CoverRect = { sx: number; sy: number; sw: number; sh: number }

export type CardLayout = {
  canvas: { width: number; height: number }
  /** 动画截图槽位 */
  main: Rect
  /** 实拍槽位；default 布局下为 null */
  photo: Rect | null
  /** 文字块起始 y */
  textTop: number
  /** 画布安全边距 */
  padding: number
  /** 文字块左边界（横版是右列起点，不等于 padding） */
  textX: number
  /** 文字可用宽度 */
  textWidth: number
  /** 日本轮廓定位小图的框；inJapan 为 false 时渲染器跳过不画，位置照留 */
  locator: Rect
  qr: { x: number; y: number; size: number }
  /** 页脚左边界（横版同样在右列，否则会压在图片上） */
  footerX: number
  /** 页脚基线 y（鸟居图标 + seichigo.com） */
  footerY: number
}

/** object-fit: cover 的源矩形：等比放大后居中裁掉溢出部分 */
export function computeCoverRect(
  imgWidth: number,
  imgHeight: number,
  boxWidth: number,
  boxHeight: number,
): CoverRect {
  const imgRatio = imgWidth / imgHeight
  const targetRatio = boxWidth / boxHeight
  if (imgRatio > targetRatio) {
    const sw = imgHeight * targetRatio
    return { sx: (imgWidth - sw) / 2, sy: 0, sw, sh: imgHeight }
  }
  const sh = imgWidth / targetRatio
  return { sx: 0, sy: (imgHeight - sh) / 2, sw: imgWidth, sh }
}

/**
 * 逐字断行（CJK 没有空格，不能按词切）。超出 maxLines 时最后一行以 … 收尾。
 * measure 由调用方传 ctx.measureText(...).width，方便在 node 里测。
 */
export function wrapLines(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const source = String(text || '').trim()
  if (!source) return []

  const lines: string[] = []
  let current = ''
  for (const char of source) {
    const next = current + char
    if (current && measure(next) > maxWidth) {
      lines.push(current)
      current = char
      if (lines.length === maxLines) break
    } else {
      current = next
    }
  }
  if (lines.length < maxLines && current) lines.push(current)

  if (lines.length === maxLines) {
    const consumed = lines.join('').length
    if (consumed < source.length) {
      let last = lines[maxLines - 1]!
      while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1)
      lines[maxLines - 1] = `${last}…`
    }
  }
  return lines
}

export function resolveCardVariant(hasPhoto: boolean): ShareCardVariant {
  return hasPhoto ? 'compare' : 'default'
}

/** 页脚字号：渲染器与几何测试共用 */
export const CARD_FOOTER_SIZES: Readonly<Record<ShareCardLayout, number>> = {
  portrait: 30,
  landscape: 22,
}

export type CardRowMetric = { size: number; gap: number }

/**
 * 四类文字行的字号、行后间距与最大行数。
 * 竖版的总高度预算：textTop 768 → 满行 bottom 1078 < locator.y 1096。
 */
export const CARD_ROW_METRICS: Readonly<
  Record<
    ShareCardLayout,
    {
      name: CardRowMetric & { maxLines: number }
      anime: CardRowMetric
      address: CardRowMetric
      note: CardRowMetric & { maxLines: number }
    }
  >
> = {
  portrait: {
    name: { size: 60, gap: 10, maxLines: 2 },
    anime: { size: 38, gap: 14 },
    address: { size: 34, gap: 12 },
    note: { size: 32, gap: 12, maxLines: 2 },
  },
  landscape: {
    name: { size: 40, gap: 12, maxLines: 1 },
    anime: { size: 28, gap: 12 },
    address: { size: 24, gap: 10 },
    note: { size: 22, gap: 10, maxLines: 1 },
  },
}

/** 地址行图钉：宽 0.62em、右侧留 0.28em，文字整体右移 offset */
const ADDRESS_PIN_WIDTH_RATIO = 0.62
const ADDRESS_PIN_GAP_RATIO = 0.28

/**
 * 地址行前缀图钉的尺寸。渲染器按它画矢量图钉并右移文字起点，
 * 断行测量也要减掉 offset，否则地址会顶出文字块右边界。
 */
export function addressPinMetrics(size: number): { width: number; gap: number; offset: number } {
  const width = size * ADDRESS_PIN_WIDTH_RATIO
  const gap = size * ADDRESS_PIN_GAP_RATIO
  return { width, gap, offset: width + gap }
}

/** 胶囊坐标行的等宽字体栈：数字对齐，扫码前肉眼好核对 */
export const GEO_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** 坐标行文本：`纬度, 经度`，各保留 4 位小数（约 11m 精度，足够找到打卡点） */
export function formatGeoLine(geo: readonly [number, number]): string {
  return `${geo[0].toFixed(4)}, ${geo[1].toFixed(4)}`
}

/** 坐标行左侧 GPS 十字圆标：边长同字号，文字右移 offset */
export function gpsIconMetrics(size: number): { size: number; gap: number; offset: number } {
  const gap = size * 0.3
  return { size, gap, offset: size + gap }
}

export function buildCardLayout(layout: ShareCardLayout, variant: ShareCardVariant): CardLayout {
  const canvas = SHARE_CARD_SIZES[layout]

  if (layout === 'portrait') {
    const padding = 64
    const visualHeight = 720
    const locatorSize = 240
    const qrSize = 180
    const locatorY = 1096
    // 竖版 compare 有意上下分栏：左右分会把两张图各压到 540 宽，实拍细节没法看
    return {
      canvas,
      main:
        variant === 'compare'
          ? { x: 0, y: 0, width: canvas.width, height: visualHeight / 2 }
          : { x: 0, y: 0, width: canvas.width, height: visualHeight },
      photo:
        variant === 'compare'
          ? { x: 0, y: visualHeight / 2, width: canvas.width, height: visualHeight / 2 }
          : null,
      textTop: visualHeight + 48,
      padding,
      textX: padding,
      textWidth: canvas.width - padding * 2,
      locator: { x: padding, y: locatorY, width: locatorSize, height: locatorSize },
      qr: {
        x: canvas.width - padding - qrSize,
        y: locatorY + (locatorSize - qrSize) / 2,
        size: qrSize,
      },
      footerX: padding,
      footerY: canvas.height - 60,
    }
  }

  // 横版：左 55% 是主视觉，文字/轮廓/二维码/页脚全部落在右列。
  // v1 用 padding 当页脚 x，改成左图右文之后那个位置会压在图片上，所以单独有 footerX。
  const padding = 40
  const visualWidth = Math.round(canvas.width * 0.55)
  const columnX = visualWidth + 32
  const locatorSize = 150
  const qrSize = 110
  const locatorY = 434
  return {
    canvas,
    main:
      variant === 'compare'
        ? { x: 0, y: 0, width: visualWidth / 2, height: canvas.height }
        : { x: 0, y: 0, width: visualWidth, height: canvas.height },
    photo:
      variant === 'compare'
        ? { x: visualWidth / 2, y: 0, width: visualWidth / 2, height: canvas.height }
        : null,
    textTop: 48,
    padding,
    textX: columnX,
    textWidth: canvas.width - columnX - padding,
    locator: { x: columnX, y: locatorY, width: locatorSize, height: locatorSize },
    qr: {
      x: canvas.width - padding - qrSize,
      // 横版轮廓带只有 150 高，二维码底对齐（474），居中会悬在带上半截
      y: locatorY + locatorSize - qrSize,
      size: qrSize,
    },
    footerX: columnX,
    footerY: canvas.height - 14,
  }
}

export type CardTextRowKind = 'name' | 'anime' | 'address' | 'note'
export type CardTextRow = { kind: CardTextRowKind; text: string; y: number; size: number }

/**
 * 按存在的行动态排版：缺地址或缺说明时后面的行直接上移，页脚与轮廓带位置固定。
 * 返回 bottom 供几何测试断言「所有行都在轮廓带之上」。
 */
export function buildCardTextPlan(input: {
  layout: ShareCardLayout
  geometry: CardLayout
  nameLines: readonly string[]
  animeLine: string
  addressLine: string
  noteLines: readonly string[]
}): { rows: CardTextRow[]; bottom: number } {
  const metrics = CARD_ROW_METRICS[input.layout]
  const rows: CardTextRow[] = []
  let cursor = input.geometry.textTop
  let lastSize = 0

  const push = (kind: CardTextRowKind, text: string, metric: CardRowMetric) => {
    if (!String(text || '').trim()) return
    rows.push({ kind, text, y: cursor, size: metric.size })
    cursor += metric.size + metric.gap
    lastSize = metric.size
  }

  for (const line of input.nameLines.slice(0, metrics.name.maxLines)) push('name', line, metrics.name)
  push('anime', input.animeLine, metrics.anime)
  push('address', input.addressLine, metrics.address)
  for (const line of input.noteLines.slice(0, metrics.note.maxLines)) push('note', line, metrics.note)

  const last = rows[rows.length - 1]
  return { rows, bottom: last ? last.y + lastSize : input.geometry.textTop }
}
