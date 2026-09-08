import type { SupportedLocale } from '@/lib/i18n/types'
import { buildJapanOutlinePath, projectJapanLatLng } from '@/lib/share/japanPath'
import { buildQrSvg } from '@/lib/share/qrSvg'
import { SHARE_CARD_SIZES, type ShareCardLayout } from '@/lib/share/types'

/**
 * 版面常量：由下线前的 canvas 常量一比一转成 CSS 用的数值。
 * 对照来源见 components/share/pointShareCardDraw.ts 的 CAPSULE_METRICS /
 * CARD_ROW_METRICS / CARD_FOOTER_SIZES / buildCardLayout。
 * 断行与省略号一律交给浏览器（flex + -webkit-line-clamp），不再手算几何。
 */
export type CardMetrics = {
  width: number
  height: number
  /** 主视觉：横版是左列宽度，竖版是顶部高度 */
  visual: number
  /** 右列（横版）/ 文字区（竖版）的左内边距 */
  columnLeft: number
  /** 右内边距 */
  columnRight: number
  /** 文字区上内边距 */
  columnTop: number
  /** 页脚下内边距 */
  columnBottom: number
  /** 竖版画布安全边距（左右同值），横版为 0（用 columnLeft/Right） */
  padding: number
  nameSize: number
  nameLines: number
  nameGap: number
  animeSize: number
  animeGap: number
  addressSize: number
  addressGap: number
  noteSize: number
  noteLines: number
  capsuleRadius: number
  capsulePadV: number
  capsulePadH: number
  capsuleGap: number
  outlineSize: number
  qrSize: number
  qrPad: number
  qrRadius: number
  titleSize: number
  coordSize: number
  subSize: number
  titleGap: number
  subGap: number
  /** 文字区与胶囊之间的最小间距 */
  capsuleTopGap: number
  footerSize: number
  taglineSize: number
  footerGap: number
}

export const CARD_METRICS: Readonly<Record<ShareCardLayout, CardMetrics>> = {
  portrait: {
    width: SHARE_CARD_SIZES.portrait.width,
    height: SHARE_CARD_SIZES.portrait.height,
    visual: 640,
    columnLeft: 64,
    columnRight: 64,
    columnTop: 36,
    columnBottom: 36,
    padding: 64,
    nameSize: 60,
    nameLines: 2,
    nameGap: 10,
    animeSize: 38,
    animeGap: 14,
    addressSize: 34,
    addressGap: 12,
    noteSize: 32,
    noteLines: 2,
    capsuleRadius: 24,
    capsulePadV: 24,
    capsulePadH: 28,
    capsuleGap: 24,
    outlineSize: 180,
    qrSize: 180,
    qrPad: 6,
    qrRadius: 12,
    titleSize: 34,
    coordSize: 28,
    subSize: 22,
    titleGap: 12,
    subGap: 10,
    capsuleTopGap: 24,
    footerSize: 30,
    taglineSize: 24,
    footerGap: 24,
  },
  landscape: {
    width: SHARE_CARD_SIZES.landscape.width,
    height: SHARE_CARD_SIZES.landscape.height,
    visual: 640,
    // 线上横版右列起点 x=672，主视觉宽 640 → 左内边距 32；右边距 36
    columnLeft: 32,
    columnRight: 36,
    columnTop: 34,
    columnBottom: 14,
    padding: 36,
    nameSize: 40,
    nameLines: 1,
    nameGap: 12,
    animeSize: 26,
    animeGap: 12,
    addressSize: 24,
    addressGap: 10,
    noteSize: 22,
    noteLines: 2,
    capsuleRadius: 16,
    capsulePadV: 14,
    capsulePadH: 16,
    capsuleGap: 14,
    outlineSize: 100,
    qrSize: 100,
    qrPad: 4,
    qrRadius: 8,
    titleSize: 22,
    coordSize: 19,
    subSize: 15,
    titleGap: 8,
    subGap: 6,
    capsuleTopGap: 16,
    footerSize: 20,
    taglineSize: 16,
    footerGap: 16,
  },
}

/** 会破坏 HTML 结构的五个字符；卡片文本全部来自数据库与用户上传，一律过这道 */
export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * anitabi 的 `s` 是场景出现的秒数；纯数字时格式化为 mm:ss（超过一小时为
 * h:mm:ss），否则原样返回。行为与下线前的
 * components/share/PointShareCard.tsx:209-218 完全一致。
 */
export function formatSceneTime(scene: string): string {
  const raw = String(scene).trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw
  const total = Math.floor(Number(raw))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 作品行：《作品名》 · 第 N 集 · mm:ss，缺哪段就少哪段（同 PointShareCard.tsx:188-205） */
export function buildAnimeMetaLine(input: {
  locale: SupportedLocale
  animeTitle: string
  episode: string | null
  /** 场景时间：纯数字秒数会先过 formatSceneTime，已格式化的值原样保留 */
  scene: string | null
}): string {
  const parts: string[] = []
  const title = String(input.animeTitle || '').trim()
  if (title) {
    parts.push(input.locale === 'en' ? title : input.locale === 'ja' ? `『${title}』` : `《${title}》`)
  }
  if (input.episode) {
    parts.push(
      input.locale === 'en'
        ? `EP ${input.episode}`
        : input.locale === 'ja'
          ? `第${input.episode}話`
          : `第 ${input.episode} 集`,
    )
  }
  if (input.scene) parts.push(formatSceneTime(input.scene))
  return parts.join(' · ')
}

export type CardHtmlInput = {
  layout: ShareCardLayout
  locale: SupportedLocale
  /** 已由 point-context 去掉作品名前缀的点位名 */
  displayName: string
  animeTitle: string
  episode: string | null
  /** 未格式化的场景秒数：纯数字时由 buildAnimeMetaLine 过 formatSceneTime 转 mm:ss */
  scene: string | null
  address: string | null
  note: string | null
  geo: [number, number] | null
  inJapan: boolean
  /** data:image/...;base64,... —— 渲染时不发外部请求，保证截图确定性 */
  animeImageDataUri: string | null
  /** 有值时切对比布局（横版左右、竖版上下） */
  photoDataUri: string | null
  qrTargetUrl: string
  text: { qrTitle: string; qrSub: string; tagline: string }
}

/** Browser Run 环境自带中日文字体，直接点名即可 */
const FONT_STACK = '"Noto Sans CJK SC","Noto Sans CJK JP",system-ui,sans-serif'
const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const COLORS = {
  name: '#0f172a',
  anime: '#db2777',
  address: '#334155',
  note: '#64748b',
  capsuleBg: '#fdf2f8',
  capsuleBorder: '#fbcfe8',
  capsuleTitle: '#be185d',
  capsuleCoord: '#334155',
  capsuleSub: '#64748b',
  pin: '#ec4899',
  locatorFill: '#fbcfe8',
  locatorStroke: '#ec4899',
  locatorMarker: '#db2777',
  footer: '#64748b',
  tagline: '#94a3b8',
} as const

/** 坐标行：`纬度, 经度`，各保留 4 位小数（约 11m 精度） */
function formatGeoLine(geo: readonly [number, number]): string {
  return `${geo[0].toFixed(4)}, ${geo[1].toFixed(4)}`
}

/** 地址行前缀的矢量小图钉：圆头 + 下方三角 + 白色内点。不用 emoji，缺字体会掉豆腐块 */
function addressPinSvg(size: number): string {
  const w = size * 0.62
  return [
    `<svg class="pin" width="${w.toFixed(2)}" height="${size}" viewBox="0 0 20 32" aria-hidden="true">`,
    `<path d="M10 0C4.48 0 0 4.48 0 10c0 7.5 10 22 10 22s10-14.5 10-22C20 4.48 15.52 0 10 0z" fill="${COLORS.pin}"/>`,
    `<circle cx="10" cy="10" r="4" fill="#ffffff"/>`,
    '</svg>',
  ].join('')
}

/** 坐标行左侧 GPS 十字圆标：圆环 + 四向短线 */
function gpsIconSvg(size: number): string {
  return [
    `<svg class="gps" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">`,
    `<g fill="none" stroke="${COLORS.pin}" stroke-width="2" stroke-linecap="round">`,
    '<circle cx="12" cy="12" r="7"/>',
    '<path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    '</g></svg>',
  ].join('')
}

/** 页脚站点名前的小鸟居：与地址图钉同风格的矢量内联 SVG（不用 emoji，缺字体会掉豆腐块） */
function toriiSvg(size: number): string {
  const w = size * 1.15
  const h = size * 0.85
  return [
    `<svg class="torii" width="${w.toFixed(2)}" height="${h.toFixed(2)}" viewBox="0 0 30 24" aria-hidden="true">`,
    `<path fill="${COLORS.pin}" d="`,
    'M1 4.4C5.2 2.4 10.4 1.5 15 1.5s9.8.9 14 2.9l-.8 2.1C24 4.9 19.5 4.1 15 4.1S6 4.9 1.8 6.5L1 4.4z',
    'M4.4 9.4h21.2v2.3H4.4z',
    'M6.5 7.1h2.9l-.8 15.4H5.7L6.5 7.1z',
    'M20.6 7.1h2.9l.8 15.4h-2.9L20.6 7.1z',
    '"/>',
    '</svg>',
  ].join('')
}

function locatorSvg(metrics: CardMetrics, geo: readonly [number, number] | null): string {
  const size = metrics.outlineSize
  const box = { width: size, height: size }
  const d = buildJapanOutlinePath(box)
  const strokeWidth = Math.max(1, size / 160)
  let marker = ''
  if (geo) {
    const point = projectJapanLatLng(box, geo[0], geo[1])
    const r = Math.max(3, size * 0.035)
    marker = `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${r.toFixed(2)}" fill="${COLORS.locatorMarker}"/>`
  }
  return [
    `<svg class="locator" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">`,
    `<path d="${d}" fill="${COLORS.locatorFill}" stroke="${COLORS.locatorStroke}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linejoin="round"/>`,
    marker,
    '</svg>',
  ].join('')
}

function visualSection(input: CardHtmlInput): string {
  const shot = (uri: string) => `<img class="shot" src="${escapeHtml(uri)}" alt="">`
  if (input.photoDataUri && input.animeImageDataUri) {
    return `<div class="visual compare">${shot(input.animeImageDataUri)}${shot(input.photoDataUri)}</div>`
  }
  if (input.animeImageDataUri) return `<div class="visual">${shot(input.animeImageDataUri)}</div>`
  if (input.photoDataUri) return `<div class="visual">${shot(input.photoDataUri)}</div>`
  return '<div class="visual empty"></div>'
}

function textRows(input: CardHtmlInput, metrics: CardMetrics): string {
  const rows: string[] = []
  const name = String(input.displayName || '').trim()
  if (name) {
    rows.push(`<div class="row name">${escapeHtml(name)}</div>`)
  }
  const anime = buildAnimeMetaLine({
    locale: input.locale,
    animeTitle: input.animeTitle,
    episode: input.episode,
    scene: input.scene,
  })
  if (anime) rows.push(`<div class="row anime clamp1">${escapeHtml(anime)}</div>`)
  const address = String(input.address || '').trim()
  if (address) {
    rows.push(
      `<div class="row address">${addressPinSvg(metrics.addressSize)}<span class="clamp1">${escapeHtml(address)}</span></div>`,
    )
  }
  const note = String(input.note || '').trim()
  if (note) rows.push(`<div class="row note clamp2">${escapeHtml(note)}</div>`)
  return rows.join('')
}

function capsuleSection(input: CardHtmlInput, metrics: CardMetrics): string {
  const locator = input.inJapan ? locatorSvg(metrics, input.geo) : ''
  const coord = input.geo
    ? `<div class="cap-coord">${gpsIconSvg(metrics.coordSize)}<span>${escapeHtml(formatGeoLine(input.geo))}</span></div>`
    : ''
  const qr = buildQrSvg(input.qrTargetUrl)
  return [
    '<div class="capsule">',
    locator,
    '<div class="middle">',
    `<div class="cap-title clamp1">${escapeHtml(input.text.qrTitle)}</div>`,
    coord,
    `<div class="cap-sub clamp1">${escapeHtml(input.text.qrSub)}</div>`,
    '</div>',
    `<div class="qr">${qr}</div>`,
    '</div>',
  ].join('')
}

function styles(input: CardHtmlInput, metrics: CardMetrics): string {
  const isPortrait = input.layout === 'portrait'
  // 无坐标行时副标题接在标题后面，用标题后的间距
  const subGap = input.geo ? metrics.subGap : metrics.titleGap
  return `
*{box-sizing:border-box}
html,body{margin:0;padding:0;overflow:hidden}
body{width:${metrics.width}px;height:${metrics.height}px;background:#ffffff;font-family:${FONT_STACK};-webkit-font-smoothing:antialiased}
.card{width:${metrics.width}px;height:${metrics.height}px;display:flex;flex-direction:${isPortrait ? 'column' : 'row'};background:#ffffff}
.visual{flex:none;${isPortrait ? `width:${metrics.width}px;height:${metrics.visual}px` : `width:${metrics.visual}px;height:${metrics.height}px`};display:flex;flex-direction:${isPortrait ? 'column' : 'row'};overflow:hidden}
.visual.empty{background:linear-gradient(135deg,#fce7f3,#fdf2f8)}
.visual .shot{width:100%;height:100%;object-fit:cover;display:block}
.visual.compare .shot{${isPortrait ? 'height:50%' : 'width:50%'}}
.column{flex:1;min-width:0;display:flex;flex-direction:column;padding:${metrics.columnTop}px ${metrics.columnRight}px ${metrics.columnBottom}px ${metrics.columnLeft}px}
.spacer{flex:1;min-height:${metrics.capsuleTopGap}px}
.clamp1,.clamp2{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}
.clamp1{-webkit-line-clamp:1;max-height:1.3em}
.clamp2{-webkit-line-clamp:2;max-height:2.7em}
.row{word-break:break-word}
.row.name{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;-webkit-line-clamp:${metrics.nameLines};max-height:${(metrics.nameLines * 1.25).toFixed(2)}em;font-size:${metrics.nameSize}px;line-height:1.25;font-weight:700;color:${COLORS.name};margin-bottom:${metrics.nameGap}px}
.row.anime{font-size:${metrics.animeSize}px;line-height:1.3;font-weight:600;color:${COLORS.anime};margin-bottom:${metrics.animeGap}px}
.row.address{display:flex;align-items:center;gap:${(metrics.addressSize * 0.28).toFixed(2)}px;font-size:${metrics.addressSize}px;line-height:1.3;font-weight:400;color:${COLORS.address};margin-bottom:${metrics.addressGap}px}
.row.address .pin{flex:none}
.row.address span{min-width:0}
.row.note{font-size:${metrics.noteSize}px;line-height:1.35;font-weight:400;color:${COLORS.note}}
.capsule{flex:none;display:flex;align-items:center;gap:${metrics.capsuleGap}px;background:${COLORS.capsuleBg};border:1px solid ${COLORS.capsuleBorder};border-radius:${metrics.capsuleRadius}px;padding:${metrics.capsulePadV}px ${metrics.capsulePadH}px}
.capsule .locator{flex:none;width:${metrics.outlineSize}px;height:${metrics.outlineSize}px}
.middle{flex:1;min-width:0}
.cap-title{font-size:${metrics.titleSize}px;line-height:1.2;font-weight:700;color:${COLORS.capsuleTitle}}
.cap-coord{display:flex;align-items:center;gap:${(metrics.coordSize * 0.3).toFixed(2)}px;font-size:${metrics.coordSize}px;line-height:1.2;color:${COLORS.capsuleCoord};font-family:${MONO_STACK};margin-top:${metrics.titleGap}px}
.cap-coord .gps{flex:none}
.cap-sub{font-size:${metrics.subSize}px;line-height:1.2;font-weight:400;color:${COLORS.capsuleSub};margin-top:${subGap}px}
.qr{flex:none;width:${metrics.qrSize}px;height:${metrics.qrSize}px;background:#ffffff;border:1px solid ${COLORS.capsuleBorder};border-radius:${metrics.qrRadius}px;padding:${metrics.qrPad}px}
.qr svg{width:100%;height:100%;display:block}
.footer{flex:none;display:flex;align-items:baseline;justify-content:space-between;margin-top:${metrics.footerGap}px;font-size:${metrics.footerSize}px;font-weight:500;color:${COLORS.footer}}
.footer .torii{vertical-align:-0.1em;margin-right:8px}
.tagline{font-size:${metrics.taglineSize}px;font-weight:400;color:${COLORS.tagline};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-left:16px}
`.trim()
}

/**
 * 卡片的唯一渲染源：输出一份自包含的 HTML 文档，交给 Browser Run 截图。
 * 图片一律内联 base64，渲染时不发任何外部请求，保证截图确定性。
 */
export function buildCardHtml(input: CardHtmlInput): string {
  const metrics = CARD_METRICS[input.layout]
  return [
    '<!DOCTYPE html>',
    '<html lang="' + escapeHtml(input.locale) + '"><head><meta charset="utf-8">',
    `<style>${styles(input, metrics)}</style>`,
    '</head><body><div class="card">',
    visualSection(input),
    '<div class="column">',
    `<div class="text">${textRows(input, metrics)}</div>`,
    '<div class="spacer"></div>',
    capsuleSection(input, metrics),
    `<div class="footer"><span>${toriiSvg(metrics.footerSize)}seichigo.com</span><span class="tagline">${escapeHtml(input.text.tagline)}</span></div>`,
    '</div></div></body></html>',
  ].join('')
}
