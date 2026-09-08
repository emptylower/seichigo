'use client'

import { useCallback, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import type { SupportedLocale } from '@/lib/i18n/types'
import { SHARE_CARD_MAX_BYTES, type ShareCardLayout } from '@/lib/share/types'
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
  type CardTextRowKind,
  type Rect,
} from '@/components/share/pointShareCardDraw'
import { drawJapanLocator, loadJapanOutline } from '@/components/share/japanLocator'

export type PointShareCardInput = {
  layout: ShareCardLayout
  locale: SupportedLocale
  /** 已由 point-context 去掉作品名前缀的点位名 */
  pointName: string
  animeTitle: string
  episode: string | null
  scene: string | null
  /** 行政区地址（都道府县 市区町村 町丁目）；null 时不画地址行 */
  address: string | null
  /** 点位说明；null 时不画说明行 */
  note: string | null
  /** [lat, lng]，用来在轮廓上打定位点 */
  geo: [number, number] | null
  /** 坐标是否落在日本 bbox 内；false 时不画轮廓，位置留白 */
  inJapan: boolean
  /** 点位动画截图原始 URL */
  animeImage: string
  /** 用户实拍的 object URL；有值就切 compare 布局 */
  photoObjectUrl: string | null
  /** 短链绝对地址，画进二维码（qrUrl 缺省时退回它） */
  shareUrl: string
  /** 二维码内容：带 c=save 渠道参数的短链 */
  qrUrl?: string
  /** 胶囊与页脚的三语文案，由 Panel 用 t() 注入 */
  cardText: {
    /** 胶囊中列第一行（share.cardQrTitle） */
    qrTitle: string
    /** 胶囊中列第三行（share.cardQrSub） */
    qrSub: string
    /** 页脚右侧标语（share.cardTagline） */
    tagline: string
  }
}

const QUALITY_FIRST = 0.9
const QUALITY_RETRY = 0.72

function loadImage(src: string, crossOrigin?: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = crossOrigin
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    img.src = src
  })
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality))
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  box: { x: number; y: number; width: number; height: number },
) {
  const rect = computeCoverRect(img.width, img.height, box.width, box.height)
  ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, box.x, box.y, box.width, box.height)
}

const FONT_STACK = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans", sans-serif'

function fontOf(size: number, weight: string): string {
  return `${weight} ${size}px ${FONT_STACK}`
}

/** 品牌粉。地址行前缀不再用 📍 —— 设备没有 emoji 字体时会掉成豆腐块 */
const ADDRESS_PIN_COLOR = '#ec4899'

/**
 * 矢量小图钉：圆头 + 下方三角 + 白色内点，整体宽 addressPinMetrics(size).width、高 size。
 * y 是文字行顶（textBaseline 为 top），与地址文字对齐。
 */
function drawAddressPin(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const radius = addressPinMetrics(size).width / 2
  const cx = x + radius
  const cy = y + radius + size * 0.1
  ctx.save()
  ctx.fillStyle = ADDRESS_PIN_COLOR
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx - radius * 0.62, cy + radius * 0.62)
  ctx.lineTo(cx + radius * 0.62, cy + radius * 0.62)
  ctx.lineTo(cx, y + size)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(cx, cy, radius * 0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const ROW_COLORS: Readonly<Record<CardTextRowKind, string>> = {
  name: '#0f172a',
  anime: '#db2777',
  address: '#334155',
  note: '#64748b',
}

const ROW_WEIGHTS: Readonly<Record<CardTextRowKind, string>> = {
  name: '700',
  anime: '600',
  address: '400',
  note: '400',
}

/** 胶囊配色（v2.1 定稿）：粉底、粉边、品牌粉标题 */
const CAPSULE_COLORS = {
  bg: '#fdf2f8',
  border: '#fbcfe8',
  title: '#be185d',
  coord: '#334155',
  sub: '#64748b',
  gps: '#ec4899',
} as const

/** 手写圆角矩形路径：不依赖 ctx.roundRect（老 Safari 没有），测试里也好断言 */
function roundRectPath(ctx: CanvasRenderingContext2D, rect: Rect, radius: number): void {
  const r = Math.min(radius, rect.width / 2, rect.height / 2)
  ctx.beginPath()
  ctx.moveTo(rect.x + r, rect.y)
  ctx.arcTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height, r)
  ctx.arcTo(rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height, r)
  ctx.arcTo(rect.x, rect.y + rect.height, rect.x, rect.y, r)
  ctx.arcTo(rect.x, rect.y, rect.x + rect.width, rect.y, r)
  ctx.closePath()
}

/** GPS 十字圆标：圆环 + 四向短线。y 是坐标行行顶（textBaseline top），图标边长同字号 */
function drawGpsCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size / 2
  const cy = y + size / 2
  const ring = size * 0.32
  const stubInner = ring + size * 0.09
  const stubOuter = size * 0.5
  ctx.save()
  ctx.strokeStyle = CAPSULE_COLORS.gps
  ctx.lineWidth = Math.max(1.5, size * 0.08)
  ctx.beginPath()
  ctx.arc(cx, cy, ring, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    ctx.moveTo(cx + dx * stubInner, cy + dy * stubInner)
    ctx.lineTo(cx + dx * stubOuter, cy + dy * stubOuter)
  }
  ctx.stroke()
  ctx.restore()
}

/** 作品行：《作品名》 · 第 N 集 · mm:ss，缺哪段就少哪段 */
function animeMetaLine(input: PointShareCardInput): string {
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

/** anitabi 的 `s` 是场景出现的秒数；纯数字时格式化为 mm:ss（超过一小时为 h:mm:ss），否则原样返回。 */
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

export default function PointShareCard({
  input,
  onRendered,
  onError,
}: {
  input: PointShareCardInput
  onRendered: (blob: Blob) => void
  onError: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const render = useCallback(async (isCancelled: () => boolean) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      // 实拍先加载：失败就退回 default，compare 留个空槽比不出图更难看
      const photoImg = input.photoObjectUrl
        ? await loadImage(input.photoObjectUrl).catch(() => null)
        : null
      if (isCancelled()) return
      const variant = resolveCardVariant(Boolean(photoImg))
      const layout = buildCardLayout(input.layout, variant)
      const capsuleM = CAPSULE_METRICS[input.layout]
      const qrImageSize = layout.qr.size - capsuleM.qrPad * 2
      canvas.width = layout.canvas.width
      canvas.height = layout.canvas.height

      const qrDataUrl = await QRCode.toDataURL(input.qrUrl || input.shareUrl, {
        margin: 1,
        width: qrImageSize,
        color: { dark: '#111827', light: '#ffffff' },
      })
      if (isCancelled()) return

      // 动画截图走与地图一致的候选梯（同源代理优先）：anitabi 投递域不带 CORS 头，
      // crossOrigin='anonymous' 直连必失败，逐个候选降级
      const candidates = input.animeImage
        ? getMapDisplayImageCandidates(input.animeImage, { kind: 'point' })
        : []
      const loadAnime = async (): Promise<HTMLImageElement | null> => {
        for (const candidate of candidates) {
          const img = await loadImage(candidate, 'anonymous').catch(() => null)
          if (isCancelled()) return null
          if (img) return img
        }
        return null
      }

      const [animeImg, qrImg, logoImg, outline] = await Promise.all([
        loadAnime(),
        loadImage(qrDataUrl).catch(() => null),
        loadImage('/brand/web-logo.png').catch(() => null),
        // 轮廓 JSON 只有日本境内点位才下载；下不来就不画轮廓，别拖垮整张卡
        input.inJapan ? loadJapanOutline().catch(() => null) : Promise.resolve(null),
      ])
      if (isCancelled()) return

      // 底色
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, layout.canvas.width, layout.canvas.height)

      // 主视觉
      if (animeImg) {
        drawCover(ctx, animeImg, layout.main)
      } else {
        const gradient = ctx.createLinearGradient(0, 0, layout.main.width, layout.main.height)
        gradient.addColorStop(0, '#fce7f3')
        gradient.addColorStop(1, '#fdf2f8')
        ctx.fillStyle = gradient
        ctx.fillRect(layout.main.x, layout.main.y, layout.main.width, layout.main.height)
      }
      if (layout.photo && photoImg) drawCover(ctx, photoImg, layout.photo)

      // 文字块：先按各自字号量出行，再交给 buildCardTextPlan 排 y
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      const rowMetrics = CARD_ROW_METRICS[input.layout]
      const measure = (text: string) => ctx.measureText(text).width

      ctx.font = fontOf(rowMetrics.name.size, ROW_WEIGHTS.name)
      const nameLines = wrapLines(measure, input.pointName, layout.textWidth, rowMetrics.name.maxLines)

      ctx.font = fontOf(rowMetrics.anime.size, ROW_WEIGHTS.anime)
      const animeLineText = wrapLines(measure, animeMetaLine(input), layout.textWidth, 1)[0] || ''

      ctx.font = fontOf(rowMetrics.address.size, ROW_WEIGHTS.address)
      const addressPin = addressPinMetrics(rowMetrics.address.size)
      const addressLineText = input.address
        ? wrapLines(measure, input.address, layout.textWidth - addressPin.offset, 1)[0] || ''
        : ''

      ctx.font = fontOf(rowMetrics.note.size, ROW_WEIGHTS.note)
      const noteLines = wrapLines(
        measure,
        String(input.note || ''),
        layout.textWidth,
        rowMetrics.note.maxLines,
      )

      const plan = buildCardTextPlan({
        layout: input.layout,
        geometry: layout,
        nameLines,
        animeLine: animeLineText,
        addressLine: addressLineText,
        noteLines,
      })
      for (const row of plan.rows) {
        // 地址行左侧留给矢量图钉，文字整体右移一个 offset
        const isAddress = row.kind === 'address'
        if (isAddress) drawAddressPin(ctx, layout.textX, row.y, row.size)
        ctx.fillStyle = ROW_COLORS[row.kind]
        ctx.font = fontOf(row.size, ROW_WEIGHTS[row.kind])
        ctx.fillText(row.text, isAddress ? layout.textX + addressPin.offset : layout.textX, row.y)
      }

      // 导航胶囊（v2.1）：粉底圆角横条，左轮廓 / 中三行 / 右二维码白卡
      roundRectPath(ctx, layout.capsule, capsuleM.radius)
      ctx.fillStyle = CAPSULE_COLORS.bg
      ctx.fill()
      ctx.strokeStyle = CAPSULE_COLORS.border
      ctx.lineWidth = 1
      ctx.stroke()

      // 左：日本轮廓定位小图；海外点位不画，中列左移贴胶囊左缘
      if (input.inJapan && outline) {
        drawJapanLocator(
          ctx,
          layout.locator,
          input.geo ? { lat: input.geo[0], lng: input.geo[1] } : null,
          outline,
        )
      }

      // 右：二维码白卡（白底、粉边、圆角），图按 qrPad 内缩
      roundRectPath(
        ctx,
        { x: layout.qr.x, y: layout.qr.y, width: layout.qr.size, height: layout.qr.size },
        capsuleM.qrRadius,
      )
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = CAPSULE_COLORS.border
      ctx.lineWidth = 1
      ctx.stroke()
      if (qrImg) {
        ctx.drawImage(qrImg, layout.qr.x + capsuleM.qrPad, layout.qr.y + capsuleM.qrPad, qrImageSize, qrImageSize)
      }

      // 中：三行——胶囊标题 / 等宽坐标行（左侧 GPS 十字圆标）/ 副标题；无坐标时两行居中
      const middle = buildCapsuleMiddle(layout, input.inJapan)
      const middleRows = buildCapsuleMiddleRows(input.layout, middle, Boolean(input.geo))
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      ctx.font = fontOf(capsuleM.titleSize, '700')
      const qrTitleText = wrapLines(measure, input.cardText.qrTitle, middle.width, 1)[0] || ''
      ctx.fillStyle = CAPSULE_COLORS.title
      ctx.fillText(qrTitleText, middle.x, middleRows.title.y)
      if (middleRows.coord && input.geo) {
        drawGpsCrosshair(ctx, middle.x, middleRows.coord.y, capsuleM.coordSize)
        ctx.font = `${capsuleM.coordSize}px ${GEO_FONT_STACK}`
        ctx.fillStyle = CAPSULE_COLORS.coord
        ctx.fillText(
          formatGeoLine(input.geo),
          middle.x + gpsIconMetrics(capsuleM.coordSize).offset,
          middleRows.coord.y,
        )
      }
      ctx.font = fontOf(capsuleM.subSize, '400')
      const qrSubText = wrapLines(measure, input.cardText.qrSub, middle.width, 1)[0] || ''
      ctx.fillStyle = CAPSULE_COLORS.sub
      ctx.fillText(qrSubText, middle.x, middleRows.sub.y)

      // 页脚：鸟居图标 + 站点名
      ctx.textBaseline = 'alphabetic'
      const footerSize = CARD_FOOTER_SIZES[input.layout]
      ctx.fillStyle = '#9ca3af'
      ctx.font = `500 ${footerSize}px system-ui, -apple-system, sans-serif`
      ctx.fillText('⛩ seichigo.com', layout.footerX, layout.footerY)
      if (logoImg) {
        const logoHeight = footerSize + 8
        const logoWidth = logoHeight * (logoImg.width / logoImg.height || 1)
        ctx.drawImage(
          logoImg,
          layout.canvas.width - layout.padding - logoWidth,
          layout.footerY - logoHeight + 6,
          logoWidth,
          logoHeight,
        )
      }

      let blob = await toBlob(canvas, QUALITY_FIRST)
      if (isCancelled()) return
      if (blob && blob.size > SHARE_CARD_MAX_BYTES) {
        // 体积超标只降一次质量：再降画质就不能看了，宁可让上传报 413
        blob = (await toBlob(canvas, QUALITY_RETRY)) ?? blob
        if (isCancelled()) return
      }
      if (!blob) {
        onError()
        return
      }
      onRendered(blob)
    } catch (error) {
      if (isCancelled()) return
      console.error('[share.card.render_failed]', error)
      onError()
    }
  }, [input, onRendered, onError])

  // input 变化时上一次渲染立刻作废，避免旧图画完覆盖新图
  useEffect(() => {
    let cancelled = false
    void render(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [render])

  return <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
}
