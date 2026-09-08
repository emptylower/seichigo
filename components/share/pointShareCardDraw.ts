import { SHARE_CARD_SIZES, type ShareCardLayout, type ShareCardVariant } from '@/lib/share/types'

export type Rect = { x: number; y: number; width: number; height: number }
export type CoverRect = { sx: number; sy: number; sw: number; sh: number }

export type CardLayout = {
  /** 版式：胶囊度量等按它取 */
  kind: ShareCardLayout
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
  /** 导航胶囊整体外框 */
  capsule: Rect
  /** 胶囊内日本轮廓框；inJapan 为 false 时渲染器跳过不画，中列左移贴胶囊左缘 */
  locator: Rect
  /** 胶囊内二维码白卡外框；图本身按 CAPSULE_METRICS.qrPad 内缩 */
  qr: { x: number; y: number; size: number }
  /** 页脚左边界（横版同样在右列，否则会压在图片上） */
  footerX: number
  /** 页脚基线 y（鸟居图标 + seichigo.com） */
  footerY: number
  /** 页脚右边界：tagline 右对齐的锚点 */
  footerRightX: number
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

/** 横版说明行断行安全余量：实际绘制右缘比 textWidth 略窄，尾字正好越界一点点，故留 8px */
export const LANDSCAPE_NOTE_WRAP_INSET = 8

/**
 * 断行孤字防护：末行渲染宽度不足两个字（fontSize×2，约 1-2 个 CJK 字符）时，
 * 把末行并入上一行；上一行从尾部裁短，直到「裁短后 + 孤字 + …」放得下为止。
 * 点位名/说明被 maxLines 挤出的尾标点（如 】）独占一行很难看，两种版式共用。
 */
export function avoidOrphanTail(
  lines: readonly string[],
  measure: (text: string) => number,
  maxWidth: number,
  fontSize: number,
): string[] {
  if (lines.length < 2) return [...lines]
  const tail = lines[lines.length - 1]!
  if (measure(tail) >= fontSize * 2) return [...lines]
  let body = lines[lines.length - 2]!
  while (body.length > 1 && measure(`${body}${tail}…`) > maxWidth) body = body.slice(0, -1)
  return [...lines.slice(0, -2), `${body}${tail}…`]
}

export function resolveCardVariant(hasPhoto: boolean): ShareCardVariant {
  return hasPhoto ? 'compare' : 'default'
}

/** 竖版主视觉高度：基准 640、上限 760（v2.1 P2，文字块不满行时把差值补进主视觉） */
export const PORTRAIT_VISUAL_BASE = 640
export const PORTRAIT_VISUAL_MAX = 760

/** 竖版主视觉高度 = min(760, 640 + 满行与实际文字块的高度差)；实际不低于满行时维持 640 */
export function portraitVisualHeight(fullTextBlockH: number, actualTextBlockH: number): number {
  const compensation = Math.max(0, fullTextBlockH - actualTextBlockH)
  return Math.min(PORTRAIT_VISUAL_MAX, PORTRAIT_VISUAL_BASE + compensation)
}

/** 页脚字号：渲染器与几何测试共用。v2.1 横版 20、竖版 30；tagline 另算 */
export const CARD_FOOTER_SIZES: Readonly<Record<ShareCardLayout, number>> = {
  portrait: 30,
  landscape: 20,
}

/** 页脚右侧 tagline 字号（share.cardTagline），右对齐、宽度不够时省略 */
export const CARD_FOOTER_TAGLINE_SIZES: Readonly<Record<ShareCardLayout, number>> = {
  portrait: 24,
  landscape: 16,
}

/**
 * 导航胶囊的版面常量（v2.1 定稿）：粉底圆角横条，左轮廓 / 中三行 / 右二维码。
 * padV/padH 是内边距（竖×横），gap 是三段之间的横向间距，
 * titleGap/subGap 是中列标题后、坐标行后的行间距。
 */
export const CAPSULE_METRICS: Readonly<
  Record<
    ShareCardLayout,
    {
      radius: number
      padV: number
      padH: number
      gap: number
      outlineSize: number
      qrSize: number
      qrPad: number
      qrRadius: number
      titleSize: number
      coordSize: number
      subSize: number
      titleGap: number
      subGap: number
    }
  >
> = {
  portrait: {
    radius: 24,
    padV: 24,
    padH: 28,
    gap: 24,
    outlineSize: 180,
    qrSize: 180,
    qrPad: 6,
    qrRadius: 12,
    titleSize: 34,
    coordSize: 28,
    subSize: 22,
    titleGap: 12,
    subGap: 10,
  },
  landscape: {
    radius: 16,
    padV: 14,
    padH: 16,
    gap: 14,
    outlineSize: 100,
    qrSize: 100,
    qrPad: 4,
    qrRadius: 8,
    titleSize: 22,
    coordSize: 19,
    subSize: 15,
    titleGap: 8,
    subGap: 6,
  },
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
    anime: { size: 26, gap: 12 },
    address: { size: 24, gap: 10 },
    note: { size: 22, gap: 10, maxLines: 2 },
  },
}

/**
 * 文字块高度（相对 textTop）：存在的行累加「字号 + 行后间距」，末行不带间距。
 * 与 buildCardTextPlan 的 bottom - textTop 一致；满行/实际各算一次供 P2 补偿。
 */
export function cardTextBlockHeight(
  layout: ShareCardLayout,
  rows: { nameLines: number; hasAnime: boolean; hasAddress: boolean; noteLines: number },
): number {
  const m = CARD_ROW_METRICS[layout]
  const metrics: CardRowMetric[] = []
  for (let i = 0, n = Math.min(rows.nameLines, m.name.maxLines); i < n; i++) metrics.push(m.name)
  if (rows.hasAnime) metrics.push(m.anime)
  if (rows.hasAddress) metrics.push(m.address)
  for (let i = 0, n = Math.min(rows.noteLines, m.note.maxLines); i < n; i++) metrics.push(m.note)
  if (!metrics.length) return 0
  const sizes = metrics.reduce((sum, r) => sum + r.size, 0)
  const gaps = metrics.slice(0, -1).reduce((sum, r) => sum + r.gap, 0)
  return sizes + gaps
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

export function buildCardLayout(
  layout: ShareCardLayout,
  variant: ShareCardVariant,
  opts?: { visualHeight?: number },
): CardLayout {
  const canvas = SHARE_CARD_SIZES[layout]

  if (layout === 'portrait') {
    const padding = 64
    // v2.1：主视觉基准 640，给导航胶囊腾出底部空间；文字区上边距 36。
    // P2 起可由调用方传入 visualHeight（文字块不满行时按差值补偿），夹在 640-760。
    const visualHeight = Math.min(
      PORTRAIT_VISUAL_MAX,
      Math.max(PORTRAIT_VISUAL_BASE, opts?.visualHeight ?? PORTRAIT_VISUAL_BASE),
    )
    const m = CAPSULE_METRICS.portrait
    // 胶囊锚底：胶囊底 + 24 间距 + 页脚行高（30*1.2）恰好落在 1440-36 的底边距上
    const capsuleBottom = canvas.height - 36 - 24 - CARD_FOOTER_SIZES.portrait * 1.2
    const capsuleHeight = m.outlineSize + m.padV * 2
    const capsule: Rect = {
      x: padding,
      y: capsuleBottom - capsuleHeight,
      width: canvas.width - padding * 2,
      height: capsuleHeight,
    }
    // 竖版 compare 有意上下分栏：左右分会把两张图各压到 540 宽，实拍细节没法看
    return {
      kind: layout,
      canvas,
      main:
        variant === 'compare'
          ? { x: 0, y: 0, width: canvas.width, height: visualHeight / 2 }
          : { x: 0, y: 0, width: canvas.width, height: visualHeight },
      photo:
        variant === 'compare'
          ? { x: 0, y: visualHeight / 2, width: canvas.width, height: visualHeight / 2 }
          : null,
      textTop: visualHeight + 36,
      padding,
      textX: padding,
      textWidth: canvas.width - padding * 2,
      capsule,
      locator: {
        x: capsule.x + m.padH,
        y: capsule.y + m.padV,
        width: m.outlineSize,
        height: m.outlineSize,
      },
      qr: {
        x: capsule.x + capsule.width - m.padH - m.qrSize,
        y: capsule.y + m.padV,
        size: m.qrSize,
      },
      footerX: padding,
      footerY: capsuleBottom + 24 + CARD_FOOTER_SIZES.portrait,
      footerRightX: canvas.width - padding,
    }
  }

  // 横版：左 640 是主视觉，文字/胶囊/页脚全部落在右列（x 672 起，右边距 36）。
  // v1 用 padding 当页脚 x，改成左图右文之后那个位置会压在图片上，所以单独有 footerX。
  const visualWidth = 640
  const columnX = 672
  const rightMargin = 36
  const m = CAPSULE_METRICS.landscape
  const footerY = canvas.height - 14
  // 胶囊底 = 页脚顶（基线 - 字号，保守按全字号）再往上 16
  const capsuleBottom = footerY - CARD_FOOTER_SIZES.landscape - 16
  const capsuleHeight = m.outlineSize + m.padV * 2
  const capsule: Rect = {
    x: columnX,
    y: capsuleBottom - capsuleHeight,
    width: canvas.width - columnX - rightMargin,
    height: capsuleHeight,
  }
  return {
    kind: layout,
    canvas,
    main:
      variant === 'compare'
        ? { x: 0, y: 0, width: visualWidth / 2, height: canvas.height }
        : { x: 0, y: 0, width: visualWidth, height: canvas.height },
    photo:
      variant === 'compare'
        ? { x: visualWidth / 2, y: 0, width: visualWidth / 2, height: canvas.height }
        : null,
    textTop: 34,
    padding: rightMargin,
    textX: columnX,
    textWidth: canvas.width - columnX - rightMargin,
    capsule,
    locator: {
      x: capsule.x + m.padH,
      y: capsule.y + m.padV,
      width: m.outlineSize,
      height: m.outlineSize,
    },
    qr: {
      x: capsule.x + capsule.width - m.padH - m.qrSize,
      y: capsule.y + m.padV,
      size: m.qrSize,
    },
    footerX: columnX,
    footerY,
    footerRightX: canvas.width - rightMargin,
  }
}

/** 胶囊中列（三行文案）的内容框；inJapan 为 false 时轮廓不画，中列贴胶囊左缘 */
export function buildCapsuleMiddle(layout: CardLayout, inJapan: boolean): Rect {
  const m = CAPSULE_METRICS[layout.kind]
  const x = inJapan
    ? layout.locator.x + layout.locator.width + m.gap
    : layout.capsule.x + m.padH
  const right = layout.qr.x - m.gap
  return {
    x,
    y: layout.capsule.y + m.padV,
    width: right - x,
    height: layout.capsule.height - m.padV * 2,
  }
}

export type CapsuleMiddleRows = {
  title: { y: number; size: number }
  /** geo 为 null 时不画坐标行 */
  coord: { y: number; size: number } | null
  sub: { y: number; size: number }
}

/** 中列三行（无坐标时两行）的垂直居中排版；y 是行顶（textBaseline top） */
export function buildCapsuleMiddleRows(
  layout: ShareCardLayout,
  middle: Rect,
  hasGeo: boolean,
): CapsuleMiddleRows {
  const m = CAPSULE_METRICS[layout]
  const sizes = hasGeo ? [m.titleSize, m.coordSize, m.subSize] : [m.titleSize, m.subSize]
  const gaps = hasGeo ? [m.titleGap, m.subGap] : [m.titleGap]
  const total = sizes.reduce((sum, size) => sum + size, 0) + gaps.reduce((sum, gap) => sum + gap, 0)
  let cursor = middle.y + (middle.height - total) / 2
  const take = (size: number) => {
    const slot = { y: cursor, size }
    cursor += size + (gaps.shift() ?? 0)
    return slot
  }
  const title = take(m.titleSize)
  const coord = hasGeo ? take(m.coordSize) : null
  const sub = take(m.subSize)
  return { title, coord, sub }
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
