'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Download, Share2, X, Copy, Check, Loader2 } from 'lucide-react'
import QRCode from 'qrcode'
import { buildGoogleStaticMapUrl } from '@/lib/route/google'
import { toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'

export interface RouteBookCardProps {
  animeTitle: string
  routeBookTitle: string
  cityName: string
  totalPoints: number
  totalDistance: string
  completionDate: string
  points: { lat: number; lng: number }[]
  featuredImages: string[]
  shareUrl: string
  onClose?: () => void
}

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1920
const MAP_HEIGHT = 800
const PADDING = 80
const QR_SIZE = 220
const THUMB_SIZE = 280
const LOGO_HEIGHT = 60

export default function RouteBookCard({
  animeTitle,
  routeBookTitle,
  cityName,
  totalPoints,
  totalDistance,
  completionDate,
  points,
  featuredImages,
  shareUrl,
  onClose
}: RouteBookCardProps) {
  const [isGenerating, setIsGenerating] = useState(true)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const generateCard = useCallback(async () => {
    setIsGenerating(true)
    setError(null)

    try {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
      const mapUrl = buildGoogleStaticMapUrl(points, { 
        apiKey, 
        width: 1080, 
        height: 800, 
        scale: 2 
      })

      const loadImage = (src: string, crossOrigin?: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        if (crossOrigin) img.crossOrigin = crossOrigin
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
        img.src = src
      })

      const qrDataUrl = await QRCode.toDataURL(window.location.origin, {
        margin: 1,
        width: QR_SIZE,
        color: { dark: '#111827', light: '#ffffff' }
      })

      const [mapImage, qrImage, logoImage, ...thumbImages] = await Promise.all([
        mapUrl ? loadImage(mapUrl, 'anonymous').catch(() => null) : Promise.resolve(null),
        loadImage(qrDataUrl),
        loadImage('/brand/web-logo.png').catch(() => null),
        ...featuredImages.slice(0, 3).map((src, idx) =>
          loadImage(toCanvasSafeImageUrl(src, `routebook-thumb-${idx + 1}`), 'anonymous').catch(() => null)
        )
      ])

      canvas.width = CARD_WIDTH
      canvas.height = CARD_HEIGHT

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

      if (mapImage) {
        ctx.drawImage(mapImage, 0, 0, CARD_WIDTH, MAP_HEIGHT)
      } else {
        const mapFallback = ctx.createLinearGradient(0, 0, CARD_WIDTH, MAP_HEIGHT)
        mapFallback.addColorStop(0, '#fdf2f8')
        mapFallback.addColorStop(1, '#fee2e2')
        ctx.fillStyle = mapFallback
        ctx.fillRect(0, 0, CARD_WIDTH, MAP_HEIGHT)
        ctx.fillStyle = '#be185d'
        ctx.font = 'bold 42px sans-serif'
        ctx.fillText('本次巡礼路线图', PADDING, 120)
        ctx.fillStyle = '#9f1239'
        ctx.font = '32px sans-serif'
        ctx.fillText('地图预览暂不可用，已展示巡礼战报摘要', PADDING, 180)
      }

      const gradient = ctx.createLinearGradient(0, MAP_HEIGHT - 200, 0, MAP_HEIGHT)
      gradient.addColorStop(0, 'rgba(255,255,255,0)')
      gradient.addColorStop(1, 'rgba(255,255,255,1)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, MAP_HEIGHT - 200, CARD_WIDTH, 200)

      let currentY = MAP_HEIGHT + 20

      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'

      ctx.font = '500 40px sans-serif'
      ctx.fillStyle = '#ec4899'
      const animeText = `《${animeTitle}》`
      const animeWidth = ctx.measureText(animeText).width
      
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(PADDING, currentY, animeWidth + 40, 70, 35)
      } else {
        ctx.rect(PADDING, currentY, animeWidth + 40, 70)
      }
      ctx.fillStyle = '#fdf2f8'
      ctx.fill()
      
      ctx.fillStyle = '#ec4899'
      ctx.fillText(animeText, PADDING + 20, currentY + 15)
      currentY += 100

      ctx.font = 'bold 72px "Noto Serif SC", serif'
      ctx.fillStyle = '#111827'
      ctx.fillText(routeBookTitle, PADDING, currentY)
      currentY += 120

      ctx.font = '400 36px sans-serif'
      ctx.fillStyle = '#6b7280'
      ctx.fillText('巡礼成果', PADDING, currentY)
      currentY += 60

      const stats = [
        { label: '打卡点位', value: `${totalPoints} 个` },
        { label: '全程跨度', value: totalDistance },
        { label: '完成时间', value: completionDate }
      ]

      stats.forEach((stat, i) => {
        const x = PADDING + i * 320
        ctx.font = '400 32px sans-serif'
        ctx.fillStyle = '#6b7280'
        ctx.fillText(stat.label, x, currentY)
        ctx.font = 'bold 44px sans-serif'
        ctx.fillStyle = '#111827'
        ctx.fillText(stat.value, x, currentY + 50)
      })
      currentY += 180

      if (thumbImages.length > 0) {
        ctx.font = '400 36px sans-serif'
        ctx.fillStyle = '#6b7280'
        ctx.fillText('精彩回顾', PADDING, currentY)
        currentY += 60

        thumbImages.forEach((img, i) => {
          if (!img) return
          const x = PADDING + i * (THUMB_SIZE + 40)
          
          ctx.save()
          ctx.beginPath()
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, currentY, THUMB_SIZE, THUMB_SIZE, 32)
          } else {
            ctx.rect(x, currentY, THUMB_SIZE, THUMB_SIZE)
          }
          ctx.clip()
          
          const imgRatio = img.width / img.height
          const targetRatio = 1
          if (imgRatio > targetRatio) {
            const w = THUMB_SIZE * imgRatio
            ctx.drawImage(img, x - (w - THUMB_SIZE) / 2, currentY, w, THUMB_SIZE)
          } else {
            const h = THUMB_SIZE / imgRatio
            ctx.drawImage(img, x, currentY - (h - THUMB_SIZE) / 2, THUMB_SIZE, h)
          }
          ctx.restore()
        })
        currentY += THUMB_SIZE + 100
      }

      const footerY = CARD_HEIGHT - PADDING - QR_SIZE
      
      ctx.drawImage(qrImage, CARD_WIDTH - PADDING - QR_SIZE, footerY, QR_SIZE, QR_SIZE)
      
      ctx.font = '400 28px sans-serif'
      ctx.fillStyle = '#9ca3af'
      ctx.textAlign = 'right'
      ctx.fillText('长按或扫描二维码', CARD_WIDTH - PADDING, footerY + QR_SIZE + 10)
      ctx.fillText('开启你的巡礼之旅', CARD_WIDTH - PADDING, footerY + QR_SIZE + 50)

      ctx.textAlign = 'left'
      if (logoImage) {
        const logoRatio = logoImage.width / logoImage.height
        ctx.drawImage(logoImage, PADDING, footerY + 40, LOGO_HEIGHT * logoRatio, LOGO_HEIGHT)
      } else {
        ctx.fillStyle = '#ec4899'
        ctx.font = 'bold 48px sans-serif'
        ctx.fillText('SeichiGo', PADDING, footerY + 60)
      }

      
      ctx.font = '400 32px sans-serif'
      ctx.fillStyle = '#6b7280'
      ctx.fillText('我的二次元圣地巡礼指南', PADDING, footerY + 120)

      canvas.toBlob((b) => {
        if (b) {
          const url = URL.createObjectURL(b)
          setPreviewUrl(url)
        }
      }, 'image/jpeg', 0.9)

    } catch (err) {
      console.error(err)
      setError('生成卡片失败，请重试。')
    } finally {
      setIsGenerating(false)
    }
  }, [animeTitle, routeBookTitle, cityName, totalPoints, totalDistance, completionDate, points, featuredImages])

  useEffect(() => {
    generateCard()
  }, [generateCard])

  const handleDownload = () => {
    if (!previewUrl) return
    const a = document.createElement('a')
    a.href = previewUrl
    a.download = `seichigo-routebook-${routeBookTitle}-${Date.now()}.jpg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleCopyText = async () => {
    const text = `我完成了《${animeTitle}》x ${cityName} 的圣地巡礼! ${totalPoints} 个点位全部打卡 ${shareUrl}`
    try {
      await navigator.clipboard.writeText(text)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text', err)
    }
  }

  const handleShare = async () => {
    if (!previewUrl) return
    try {
      if (navigator.share) {
        const response = await fetch(previewUrl)
        const blob = await response.blob()
        const file = new File([blob], 'routebook-card.jpg', { type: 'image/jpeg' })
        await navigator.share({
          files: [file],
          title: '圣地巡礼战报',
          text: `我完成了《${animeTitle}》x ${cityName} 的圣地巡礼! ${totalPoints} 个点位全部打卡`
        })
      } else {
        handleDownload()
      }
    } catch (err) {
      console.error('Share failed', err)
      handleDownload()
    }
  }

  return (
    <div className="flex flex-col bg-white rounded-3xl overflow-hidden shadow-2xl w-full max-w-md max-h-[90vh]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <button 
          onClick={onClose}
          className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <X className="w-6 h-6 text-gray-400" />
        </button>
        <h3 className="text-lg font-bold text-gray-900">生成圣地巡礼战报</h3>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="relative aspect-[1080/1920] bg-gray-50 rounded-2xl overflow-hidden border border-gray-100 shadow-inner">
          {previewUrl ? (
            <img src={previewUrl} alt="Route Book Card Preview" className="w-full h-full object-contain" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
              {isGenerating ? (
                <>
                  <Loader2 className="w-10 h-10 text-brand animate-spin" />
                  <p className="text-sm font-bold text-gray-700">正在绘制战报...</p>
                </>
              ) : (
                <p className="text-sm">生成失败: {error}</p>
              )}
            </div>
          )}
        </div>

        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <p className="text-sm text-gray-500 mb-2">分享文案</p>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-gray-800 line-clamp-2">
              我完成了《{animeTitle}》x {cityName} 的圣地巡礼! {totalPoints} 个点位全部打卡
            </p>
            <button
              onClick={handleCopyText}
              className="shrink-0 p-3 bg-white border border-gray-200 rounded-xl hover:border-brand/50 hover:bg-brand/5 transition-all"
            >
              {isCopied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5 text-gray-400" />}
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 border-t border-gray-100 bg-gray-50/50">
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={handleDownload}
            disabled={isGenerating || !previewUrl}
            className="flex items-center justify-center gap-2 py-4 px-6 bg-brand text-white rounded-2xl font-bold shadow-lg shadow-brand/20 hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <Download className="w-5 h-5" />
            <span>保存战报</span>
          </button>
          <button
            onClick={handleShare}
            disabled={isGenerating || !previewUrl}
            className="flex items-center justify-center gap-2 py-4 px-6 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <Share2 className="w-5 h-5" />
            <span>分享</span>
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
