'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Download, Share2, X, Copy, Check, Loader2 } from 'lucide-react'
import { toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'

export interface CheckInCardProps {
  animeTitle: string
  pointName: string
  cityName: string
  imageUrl: string
  shareUrl: string
  onClose?: () => void
}

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1350
const PADDING = 80
const FOOTER_HEIGHT = 320
const LOGO_SIZE = 80

export default function CheckInCard({
  animeTitle,
  pointName,
  cityName,
  imageUrl,
  shareUrl,
  onClose
}: CheckInCardProps) {
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

      const loadImage = (src: string, crossOrigin?: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        if (crossOrigin) img.crossOrigin = crossOrigin
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
        img.src = src
      })

      const safeImageUrl = imageUrl ? toCanvasSafeImageUrl(imageUrl, `${pointName}-checkin-card`) : ''
      const [mainImage, logoImage] = await Promise.all([
        safeImageUrl ? loadImage(safeImageUrl, 'anonymous').catch(() => null) : Promise.resolve(null),
        loadImage('/brand/web-logo.png').catch(() => null)
      ])

      canvas.width = CARD_WIDTH
      canvas.height = CARD_HEIGHT

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

      const drawImageCover = (c: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) => {
        const imgRatio = img.width / img.height
        const targetRatio = w / h
        let sx, sy, sw, sh
        if (imgRatio > targetRatio) {
          sh = img.height
          sw = img.height * targetRatio
          sx = (img.width - sw) / 2
          sy = 0
        } else {
          sw = img.width
          sh = img.width / targetRatio
          sx = 0
          sy = (img.height - sh) / 2
        }
        c.drawImage(img, sx, sy, sw, sh, x, y, w, h)
      }

      const mainImageHeight = CARD_HEIGHT - FOOTER_HEIGHT
      if (mainImage) {
        drawImageCover(ctx, mainImage, 0, 0, CARD_WIDTH, mainImageHeight)
      } else {
        const fallbackGradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, mainImageHeight)
        fallbackGradient.addColorStop(0, '#fce7f3')
        fallbackGradient.addColorStop(1, '#fdf2f8')
        ctx.fillStyle = fallbackGradient
        ctx.fillRect(0, 0, CARD_WIDTH, mainImageHeight)
        ctx.fillStyle = '#be185d'
        ctx.font = 'bold 52px sans-serif'
        ctx.fillText('SeichiGo 打卡', PADDING, 120)
      }

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, mainImageHeight, CARD_WIDTH, FOOTER_HEIGHT)

      const gradient = ctx.createLinearGradient(0, mainImageHeight - 200, 0, mainImageHeight)
      gradient.addColorStop(0, 'rgba(0,0,0,0)')
      gradient.addColorStop(1, 'rgba(0,0,0,0.1)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, mainImageHeight - 200, CARD_WIDTH, 200)

      ctx.textBaseline = 'top'
      
      ctx.fillStyle = '#6b7280'
      ctx.font = '400 36px sans-serif'
      ctx.fillText(`在 ${cityName} 找到了`, PADDING, mainImageHeight + 60)

      ctx.fillStyle = '#111827'
      ctx.font = 'bold 56px sans-serif'
      ctx.fillText(`《${animeTitle}》的取景地`, PADDING, mainImageHeight + 115)

      ctx.fillStyle = '#9ca3af'
      ctx.font = '400 32px sans-serif'
      ctx.fillText(`${pointName} · ${cityName}`, PADDING, mainImageHeight + 200)

      if (logoImage) {
        const logoAspectRatio = logoImage.width / logoImage.height
        const logoH = LOGO_SIZE
        const logoW = logoH * logoAspectRatio
        ctx.drawImage(logoImage, CARD_WIDTH - logoW - PADDING, mainImageHeight + (FOOTER_HEIGHT - logoH) / 2, logoW, logoH)
      } else {
        ctx.fillStyle = '#ec4899'
        ctx.font = 'bold 44px sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText('SeichiGo', CARD_WIDTH - PADDING, mainImageHeight + FOOTER_HEIGHT / 2)
        ctx.textAlign = 'left'
      }

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
  }, [imageUrl, animeTitle, pointName, cityName])

  useEffect(() => {
    generateCard()
  }, [generateCard])

  const handleDownload = () => {
    if (!previewUrl) return
    const a = document.createElement('a')
    a.href = previewUrl
    a.download = `seichigo-checkin-${pointName}-${Date.now()}.jpg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleCopyText = async () => {
    const text = `在 ${cityName} 找到了《${animeTitle}》的取景地! ${shareUrl}`
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
        const file = new File([blob], 'checkin-card.jpg', { type: 'image/jpeg' })
        await navigator.share({
          files: [file],
          title: '我的圣地巡礼打卡',
          text: `在 ${cityName} 找到了《${animeTitle}》的取景地! ${shareUrl}`
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
    <div className="flex flex-col bg-white rounded-3xl overflow-hidden shadow-2xl max-w-md mx-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <button 
          onClick={onClose}
          className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <X className="w-6 h-6 text-gray-400" />
        </button>
        <h3 className="text-lg font-bold text-gray-900">分享打卡卡片</h3>
        <div className="w-10" />
      </div>

      <div className="p-6 space-y-6">
        <div className="relative aspect-[1080/1350] bg-gray-50 rounded-2xl overflow-hidden border border-gray-100 shadow-inner">
          {previewUrl ? (
            <img src={previewUrl} alt="Check-in Card Preview" className="w-full h-full object-contain" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
              {isGenerating ? (
                <>
                  <Loader2 className="w-10 h-10 text-brand animate-spin" />
                  <p className="text-sm font-bold text-gray-700">正在生成卡片...</p>
                </>
              ) : (
                <p className="text-sm">生成失败</p>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100 font-medium">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
            <p className="text-sm text-gray-500 mb-2">分享文案</p>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium text-gray-800 line-clamp-2">
                在 {cityName} 找到了《{animeTitle}》的取景地! {shareUrl}
              </p>
              <button
                onClick={handleCopyText}
                className="shrink-0 p-3 bg-white border border-gray-200 rounded-xl hover:border-brand/50 hover:bg-brand/5 transition-all"
              >
                {isCopied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5 text-gray-400" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={handleDownload}
              disabled={isGenerating || !previewUrl}
              className="flex items-center justify-center gap-2 py-4 px-6 bg-brand text-white rounded-2xl font-bold shadow-lg shadow-brand/20 hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <Download className="w-5 h-5" />
              <span>保存卡片</span>
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
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
