'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Upload, Download, Share2, X, RotateCcw, Loader2 } from 'lucide-react'
import { toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'

export interface ComparisonImageGeneratorProps {
  animeImage: string
  animeTitle: string
  pointName: string
  episode?: string | null
  onClose?: () => void
  onSuccess?: (blob: Blob) => void
  initialUserImage?: File | string
}

const INFO_BAR_HEIGHT = 180
const WATERMARK_SIZE = 80
const PADDING = 60

export default function ComparisonImageGenerator({
  animeImage,
  animeTitle,
  pointName,
  episode,
  onClose,
  onSuccess,
  initialUserImage
}: ComparisonImageGeneratorProps) {
  const [userImage, setUserImage] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [referenceLoadFailed, setReferenceLoadFailed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const safeAnimeImage = animeImage ? toCanvasSafeImageUrl(animeImage, `${pointName}-anime`) : ''

  const compressImage = useCallback(async (fileOrUrl: File | string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        const MAX_SIDE = 2500
        if (width > MAX_SIDE || height > MAX_SIDE) {
          if (width > height) {
            height = (height / width) * MAX_SIDE
            width = MAX_SIDE
          } else {
            width = (width / height) * MAX_SIDE
            height = MAX_SIDE
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = () => reject(new Error('Failed to load image for compression'))
      
      if (typeof fileOrUrl === 'string') {
        img.src = fileOrUrl
      } else {
        const reader = new FileReader()
        reader.onload = (e) => {
          img.src = e.target?.result as string
        }
        reader.onerror = reject
        reader.readAsDataURL(fileOrUrl)
      }
    })
  }, [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('只支持 JPG 或 PNG 格式。')
      return
    }

    setIsProcessing(true)
    setError(null)
    try {
      const dataUrl = await compressImage(file)
      setUserImage(dataUrl)
    } catch (err) {
      setError('处理图片时出错，请重试。')
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const generateComparison = useCallback(async () => {
    if (!userImage) return
    setIsProcessing(true)
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

      const [imgAnime, imgUser, imgLogo] = await Promise.all([
        safeAnimeImage ? loadImage(safeAnimeImage, 'anonymous').catch(() => null) : Promise.resolve(null),
        loadImage(userImage),
        loadImage('/brand/web-logo.png').catch(() => null)
      ])

      const singleWidth = 1000
      const singleHeight = (singleWidth * 9) / 16
      const totalWidth = singleWidth * 2
      const totalHeight = singleHeight + INFO_BAR_HEIGHT

      canvas.width = totalWidth
      canvas.height = totalHeight

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, totalWidth, totalHeight)

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

      if (imgAnime) {
        drawImageCover(ctx, imgAnime, 0, 0, singleWidth, singleHeight)
      } else {
        const animeFallback = ctx.createLinearGradient(0, 0, singleWidth, singleHeight)
        animeFallback.addColorStop(0, '#fdf2f8')
        animeFallback.addColorStop(1, '#ffe4e6')
        ctx.fillStyle = animeFallback
        ctx.fillRect(0, 0, singleWidth, singleHeight)
        ctx.fillStyle = '#9f1239'
        ctx.font = 'bold 42px sans-serif'
        ctx.fillText('动画原图不可用', PADDING, singleHeight / 2 - 24)
      }
      drawImageCover(ctx, imgUser, singleWidth, 0, singleWidth, singleHeight)

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, singleHeight, totalWidth, INFO_BAR_HEIGHT)

      ctx.beginPath()
      ctx.moveTo(0, singleHeight)
      ctx.lineTo(totalWidth, singleHeight)
      ctx.strokeStyle = '#f0f0f0'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.textBaseline = 'middle'
      
      ctx.fillStyle = '#111827'
      ctx.font = 'bold 48px sans-serif'
      ctx.fillText(animeTitle, PADDING, singleHeight + 70)

      ctx.fillStyle = '#6b7280'
      ctx.font = '36px sans-serif'
      const infoText = `${pointName}${episode ? ` · 第${episode}话` : ''}`
      ctx.fillText(infoText, PADDING, singleHeight + 130)

      if (imgLogo) {
        const logoAspectRatio = imgLogo.width / imgLogo.height
        const logoH = WATERMARK_SIZE
        const logoW = logoH * logoAspectRatio
        ctx.globalAlpha = 0.9
        ctx.drawImage(imgLogo, totalWidth - logoW - PADDING, singleHeight + (INFO_BAR_HEIGHT - logoH) / 2, logoW, logoH)
        ctx.globalAlpha = 1.0
      } else {
        ctx.fillStyle = '#ec4899'
        ctx.font = 'bold 40px sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText('SeichiGo', totalWidth - PADDING, singleHeight + INFO_BAR_HEIGHT / 2)
        ctx.textAlign = 'left'
      }

      canvas.toBlob((b) => {
        if (b) {
          setBlob(b)
          const url = URL.createObjectURL(b)
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return url
          })
          onSuccess?.(b)
        }
      }, 'image/jpeg', 0.9)

    } catch (err) {
      console.error(err)
      setError('合成图片失败，请检查网络或重试。')
    } finally {
      setIsProcessing(false)
    }
  }, [safeAnimeImage, animeTitle, pointName, episode, userImage, onSuccess])


  useEffect(() => {
    if (initialUserImage) {
      if (typeof initialUserImage === 'string') {
        setUserImage(initialUserImage)
      } else {
        compressImage(initialUserImage).then(setUserImage).catch(err => {
          console.error('Initial image processing failed', err)
          setError('处理初始图片失败')
        })
      }
    }
  }, [initialUserImage, compressImage])

  useEffect(() => {
    if (userImage) {
      generateComparison()
    }
  }, [userImage, generateComparison])

  useEffect(() => {
    setReferenceLoadFailed(false)
  }, [safeAnimeImage])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const handleDownload = () => {
    if (!previewUrl) return
    const a = document.createElement('a')
    a.href = previewUrl
    a.download = `seichigo-${pointName}-${Date.now()}.jpg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleShare = async () => {
    if (!blob) return
    try {
      if (navigator.share) {
        const file = new File([blob], 'comparison.jpg', { type: 'image/jpeg' })
        await navigator.share({
          files: [file],
          title: '圣地巡礼对比图',
          text: `我在 SeichiGo 制作了《${animeTitle}》的对比图！`
        })
      } else {
        handleDownload()
      }
    } catch (err) {
      console.error('Share failed', err)
      handleDownload()
    }
  }

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setUserImage(null)
    setPreviewUrl(null)
    setBlob(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="flex flex-col max-h-[90vh] bg-white rounded-t-3xl overflow-hidden shadow-2xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
        <button 
          onClick={onClose}
          className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <X className="w-6 h-6 text-gray-400" />
        </button>
        <h3 className="text-lg font-bold text-gray-900">生成对比图</h3>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500">动画/原作原图</p>
          <div className="relative aspect-[16/9] rounded-2xl overflow-hidden border border-gray-100 bg-gray-50 shadow-inner">
            {safeAnimeImage && !referenceLoadFailed ? (
              <img
                src={safeAnimeImage}
                alt={`${pointName} 动画原图`}
                className="h-full w-full object-cover"
                loading="lazy"
                onError={() => setReferenceLoadFailed(true)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-gray-400">
                <p className="text-sm font-medium text-gray-500">动画原图不可用</p>
                <p className="text-xs">你依然可以上传照片生成对比图</p>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100 font-medium">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500">上传区</p>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/jpeg,image/png"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="group relative w-full overflow-hidden rounded-2xl border-2 border-dashed border-brand/35 bg-brand-50/40 px-6 py-10 transition-all hover:border-brand/60 hover:bg-brand/10"
          >
            {userImage ? (
              <div className="relative">
                <img
                  src={userImage}
                  alt="上传的打卡照片"
                  className="mx-auto h-52 w-full rounded-xl object-cover"
                />
                <div className="pointer-events-none absolute inset-0 flex items-end justify-center rounded-xl bg-gradient-to-t from-black/40 via-black/0 to-transparent pb-4">
                  <p className="text-sm font-semibold text-white">点击重新上传打卡照</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand/15">
                  <Upload className="h-8 w-8 text-brand" />
                </div>
                <div className="text-center">
                  <p className="text-base font-bold text-gray-700">点击上传打卡照</p>
                  <p className="mt-1 text-sm text-gray-500">支持横屏照片，效果更佳</p>
                </div>
              </div>
            )}
          </button>
        </div>

        {userImage ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500">对比图预览</p>
              <div className="relative aspect-[32/21] rounded-2xl overflow-hidden border border-gray-100 bg-gray-50 shadow-inner">
                {previewUrl ? (
                  <img src={previewUrl} alt="Comparison Preview" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-medium text-gray-400">
                    上传后自动生成预览
                  </div>
                )}

                {isProcessing ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4 bg-white/80 backdrop-blur-sm">
                    <Loader2 className="h-10 w-10 animate-spin text-brand" />
                    <p className="text-sm font-bold text-gray-700">正在绘制...</p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={handleDownload}
                disabled={isProcessing || !previewUrl}
                className="flex items-center justify-center gap-2 py-4 px-6 bg-brand text-white rounded-2xl font-bold shadow-lg shadow-brand/20 hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <Download className="w-5 h-5" />
                <span>保存相册</span>
              </button>
              <button
                onClick={handleShare}
                disabled={isProcessing || !blob}
                className="flex items-center justify-center gap-2 py-4 px-6 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <Share2 className="w-5 h-5" />
                <span>分享</span>
              </button>
            </div>
            <button
              onClick={reset}
              disabled={isProcessing}
              className="flex items-center justify-center gap-2 py-3 px-6 text-gray-500 hover:text-gray-900 font-medium transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>重新选择</span>
            </button>
          </div>
        ) : null}
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
