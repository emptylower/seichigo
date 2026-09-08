'use client'

import { useCallback, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import type { SupportedLocale } from '@/lib/i18n/types'
import { SHARE_CARD_MAX_BYTES, type ShareCardLayout } from '@/lib/share/types'
import {
  CARD_FONT_SIZES,
  buildCardLayout,
  computeCoverRect,
  resolveCardVariant,
  wrapLines,
} from '@/components/share/pointShareCardDraw'

export type PointShareCardInput = {
  layout: ShareCardLayout
  locale: SupportedLocale
  pointName: string
  animeTitle: string
  cityName: string
  episode: string | null
  scene: string | null
  /** 点位动画截图原始 URL */
  animeImage: string
  /** 用户实拍的 object URL；有值就切 compare 布局 */
  photoObjectUrl: string | null
  /** 短链绝对地址，画进二维码 */
  shareUrl: string
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

function metaLine(input: PointShareCardInput): string {
  const parts: string[] = []
  if (input.cityName) parts.push(input.cityName)
  if (input.episode) {
    parts.push(input.locale === 'en' ? `EP ${input.episode}` : `第 ${input.episode} 集`)
  }
  if (input.scene) parts.push(input.scene)
  return parts.join(' · ')
}

function animeLine(input: PointShareCardInput): string {
  if (input.locale === 'en') return input.animeTitle
  if (input.locale === 'ja') return `『${input.animeTitle}』`
  return `《${input.animeTitle}》`
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

  const render = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      // 实拍先加载：失败就退回 default，compare 留个空槽比不出图更难看
      const photoImg = input.photoObjectUrl
        ? await loadImage(input.photoObjectUrl).catch(() => null)
        : null
      const variant = resolveCardVariant(Boolean(photoImg))
      const layout = buildCardLayout(input.layout, variant)
      canvas.width = layout.canvas.width
      canvas.height = layout.canvas.height

      const qrDataUrl = await QRCode.toDataURL(input.shareUrl, {
        margin: 1,
        width: layout.qr.size,
        color: { dark: '#111827', light: '#ffffff' },
      })

      // 动画截图走与地图一致的候选梯（同源代理优先）：anitabi 投递域不带 CORS 头，
      // crossOrigin='anonymous' 直连必失败，逐个候选降级
      const candidates = input.animeImage
        ? getMapDisplayImageCandidates(input.animeImage, { kind: 'point' })
        : []
      const loadAnime = async (): Promise<HTMLImageElement | null> => {
        for (const candidate of candidates) {
          const img = await loadImage(candidate, 'anonymous').catch(() => null)
          if (img) return img
        }
        return null
      }

      const [animeImg, qrImg, logoImg] = await Promise.all([
        loadAnime(),
        loadImage(qrDataUrl).catch(() => null),
        loadImage('/brand/web-logo.png').catch(() => null),
      ])

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

      // 文字块
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      const { title: titleSize, body: bodySize } = CARD_FONT_SIZES[input.layout]

      ctx.fillStyle = '#111827'
      ctx.font = `bold ${titleSize}px system-ui, -apple-system, "PingFang SC", "Hiragino Sans", sans-serif`
      const nameLines = wrapLines(
        (text) => ctx.measureText(text).width,
        input.pointName,
        layout.textWidth,
        2,
      )
      let cursorY = layout.textTop
      for (const line of nameLines) {
        ctx.fillText(line, layout.padding, cursorY)
        cursorY += titleSize + 12
      }

      ctx.fillStyle = '#be185d'
      ctx.font = `600 ${bodySize + 4}px system-ui, -apple-system, "PingFang SC", "Hiragino Sans", sans-serif`
      const animeLines = wrapLines(
        (text) => ctx.measureText(text).width,
        animeLine(input),
        layout.textWidth,
        1,
      )
      for (const line of animeLines) {
        ctx.fillText(line, layout.padding, cursorY)
        cursorY += bodySize + 18
      }

      ctx.fillStyle = '#6b7280'
      ctx.font = `400 ${bodySize}px system-ui, -apple-system, "PingFang SC", "Hiragino Sans", sans-serif`
      const meta = metaLine(input)
      if (meta) ctx.fillText(meta, layout.padding, cursorY)

      // 二维码
      if (qrImg) {
        ctx.drawImage(qrImg, layout.qr.x, layout.qr.y, layout.qr.size, layout.qr.size)
      }

      // 页脚：鸟居图标 + 站点名
      ctx.textBaseline = 'alphabetic'
      const footerSize = CARD_FONT_SIZES[input.layout].footer
      ctx.fillStyle = '#9ca3af'
      ctx.font = `500 ${footerSize}px system-ui, -apple-system, sans-serif`
      ctx.fillText('⛩ seichigo.com', layout.padding, layout.footerY)
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
      if (blob && blob.size > SHARE_CARD_MAX_BYTES) {
        // 体积超标只降一次质量：再降画质就不能看了，宁可让上传报 413
        blob = (await toBlob(canvas, QUALITY_RETRY)) ?? blob
      }
      if (!blob) {
        onError()
        return
      }
      onRendered(blob)
    } catch (error) {
      console.error('[share.card.render_failed]', error)
      onError()
    }
  }, [input, onRendered, onError])

  useEffect(() => {
    void render()
  }, [render])

  return <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
}
