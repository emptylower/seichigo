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
  /** 左右安全边距 */
  padding: number
  /** 文字可用宽度（已扣掉二维码与边距） */
  textWidth: number
  qr: { x: number; y: number; size: number }
  /** 页脚基线 y（鸟居图标 + seichigo.com） */
  footerY: number
}

/** object-fit: cover 的源矩形，与 CheckInCard.tsx:71-87 的 drawImageCover 同算法 */
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

export function buildCardLayout(layout: ShareCardLayout, variant: ShareCardVariant): CardLayout {
  const canvas = SHARE_CARD_SIZES[layout]

  if (layout === 'portrait') {
    const padding = 64
    const visualHeight = 1000
    const qrSize = 180
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
      textTop: visualHeight + padding - 4,
      padding,
      textWidth: canvas.width - padding * 2 - qrSize - 32,
      qr: { x: canvas.width - padding - qrSize + 4, y: canvas.height - padding - qrSize - 56, size: qrSize },
      footerY: canvas.height - padding,
    }
  }

  const padding = 48
  const visualHeight = 430
  const qrSize = 120
  return {
    canvas,
    main:
      variant === 'compare'
        ? { x: 0, y: 0, width: canvas.width / 2, height: visualHeight }
        : { x: 0, y: 0, width: canvas.width, height: visualHeight },
    photo:
      variant === 'compare'
        ? { x: canvas.width / 2, y: 0, width: canvas.width / 2, height: visualHeight }
        : null,
    textTop: visualHeight + padding - 12,
    padding,
    textWidth: canvas.width - padding * 2 - qrSize - 32,
    qr: { x: canvas.width - padding - qrSize, y: visualHeight + 26, size: qrSize },
    footerY: canvas.height - padding + 12,
  }
}
