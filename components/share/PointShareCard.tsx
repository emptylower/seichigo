'use client'

import { useCallback, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import type { SupportedLocale } from '@/lib/i18n/types'
import { SHARE_CARD_MAX_BYTES, type ShareCardLayout } from '@/lib/share/types'
import {
  CARD_FOOTER_SIZES,
  CARD_ROW_METRICS,
  buildCardLayout,
  buildCardTextPlan,
  computeCoverRect,
  resolveCardVariant,
  wrapLines,
  type CardTextRowKind,
} from '@/components/share/pointShareCardDraw'
import { drawJapanLocator } from '@/components/share/japanLocator'

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

const ROW_COLORS: Readonly<Record<CardTextRowKind, string>> = {
  name: '#111827',
  anime: '#be185d',
  address: '#374151',
  note: '#6b7280',
}

const ROW_WEIGHTS: Readonly<Record<CardTextRowKind, string>> = {
  name: 'bold',
  anime: '600',
  address: '400',
  note: '400',
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
      canvas.width = layout.canvas.width
      canvas.height = layout.canvas.height

      const qrDataUrl = await QRCode.toDataURL(input.qrUrl || input.shareUrl, {
        margin: 1,
        width: layout.qr.size,
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

      const [animeImg, qrImg, logoImg] = await Promise.all([
        loadAnime(),
        loadImage(qrDataUrl).catch(() => null),
        loadImage('/brand/web-logo.png').catch(() => null),
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
      const addressLineText = input.address
        ? wrapLines(measure, `📍 ${input.address}`, layout.textWidth, 1)[0] || ''
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
        ctx.fillStyle = ROW_COLORS[row.kind]
        ctx.font = fontOf(row.size, ROW_WEIGHTS[row.kind])
        ctx.fillText(row.text, layout.textX, row.y)
      }

      // 日本轮廓定位小图：海外点位不画，位置留白（二维码位置不变）
      if (input.inJapan) {
        drawJapanLocator(
          ctx,
          layout.locator,
          input.geo ? { lat: input.geo[0], lng: input.geo[1] } : null,
        )
      }

      // 二维码
      if (qrImg) {
        ctx.drawImage(qrImg, layout.qr.x, layout.qr.y, layout.qr.size, layout.qr.size)
      }

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
