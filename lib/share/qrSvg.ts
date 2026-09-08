import { create as createQrData } from 'qrcode/lib/core/qrcode.js'
import { render as renderQrSvgTag } from 'qrcode/lib/renderer/svg-tag.js'

/** 二维码前景/背景：与下线前 canvas 版一致 */
const QR_DARK = '#111827'
const QR_LIGHT = '#ffffff'

/**
 * 服务端二维码 SVG。刻意不走 `qrcode` 的 node 入口：那条路会连带引入
 * renderer/png.js（pngjs + zlib + stream）与 renderer/svg.js 里的 require('fs')，
 * 白白把包体积和 Node 兼容面拖进 Worker。这两个深引模块都是纯计算。
 * margin 为 0：白边由外层二维码白卡的 padding 提供。
 */
export function buildQrSvg(text: string): string {
  const value = String(text || '').trim()
  if (!value) return ''
  try {
    const data = createQrData(value, { errorCorrectionLevel: 'M' })
    return renderQrSvgTag(data, {
      margin: 0,
      color: { dark: QR_DARK, light: QR_LIGHT },
    }).trim()
  } catch (error) {
    // 超长内容等编码失败：二维码没了卡片还在，别把整张卡打成 500
    console.error('[share.card.qr_failed]', { error })
    return ''
  }
}
