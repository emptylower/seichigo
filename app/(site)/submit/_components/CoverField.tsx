"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/Button'

type UploadResult = { id: string; url: string } | { error: string }

type Props = {
  articleId: string
  value: string | null
  disabled?: boolean
  onChange: (next: string | null) => void
  onBusyChange?: (busy: boolean) => void
}

const TARGET_ASPECT = 3 / 4
const RATIO_TOLERANCE = 0.015
const MAX_OUTPUT_WIDTH = 900

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function resolveClientAssetMaxBytes(): number {
  const fallback = 3_500_000
  const raw = process.env.NEXT_PUBLIC_ASSET_MAX_BYTES
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B'
  const kb = 1024
  const mb = kb * 1024
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)}MB`
  if (bytes >= kb) return `${Math.round(bytes / kb)}KB`
  return `${Math.round(bytes)}B`
}

function replaceFileExt(name: string, extWithDot: string): string {
  const base = name.trim() || 'image'
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return `${base}${extWithDot}`
  return `${base.slice(0, dot)}${extWithDot}`
}

function fileNameForMime(originalName: string, mime: string): string {
  if (mime === 'image/webp') return replaceFileExt(originalName, '.webp')
  if (mime === 'image/jpeg') return replaceFileExt(originalName, '.jpg')
  if (mime === 'image/png') return replaceFileExt(originalName, '.png')
  return replaceFileExt(originalName, '')
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), mime, quality)
    } catch {
      resolve(null)
    }
  })
}

async function loadImageFromFile(file: File): Promise<{ img: HTMLImageElement; objectUrl: string; width: number; height: number }> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('无法读取图片'))
    img.src = url
  })
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  if (!width || !height) {
    URL.revokeObjectURL(url)
    throw new Error('无法读取图片尺寸')
  }
  return { img, objectUrl: url, width, height }
}

async function encodeCoverFromCrop(opts: {
  img: HTMLImageElement
  sourceFileName: string
  maxBytes: number
  crop: { sx: number; sy: number; sw: number; sh: number }
}): Promise<File> {
  const srcW = opts.img.naturalWidth || opts.img.width
  const srcH = opts.img.naturalHeight || opts.img.height
  if (!srcW || !srcH) throw new Error('无法读取图片尺寸')

  const sw = Math.max(1, Math.min(srcW, opts.crop.sw))
  const sh = Math.max(1, Math.min(srcH, opts.crop.sh))
  const sx = clamp(opts.crop.sx, 0, Math.max(0, srcW - sw))
  const sy = clamp(opts.crop.sy, 0, Math.max(0, srcH - sh))

  const baseOutW = Math.max(1, Math.min(MAX_OUTPUT_WIDTH, Math.round(sw)))
  const baseOutH = Math.max(1, Math.round(baseOutW / TARGET_ASPECT))

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  const tryEncode = async (w: number, h: number): Promise<File | null> => {
    canvas.width = Math.max(1, Math.floor(w))
    canvas.height = Math.max(1, Math.floor(h))
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(opts.img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

    const mimeCandidates = ['image/webp', 'image/jpeg'] as const
    for (const mime of mimeCandidates) {
      for (let q = 0.9; q >= 0.6; q -= 0.1) {
        const blob = await canvasToBlob(canvas, mime, q)
        if (!blob) continue
        if (blob.size <= opts.maxBytes) {
          const name = fileNameForMime(opts.sourceFileName || 'cover', blob.type || mime)
          return new File([blob], name, { type: blob.type || mime, lastModified: Date.now() })
        }
      }
    }
    return null
  }

  let outW = baseOutW
  let outH = baseOutH
  for (let attempt = 0; attempt < 5; attempt++) {
    const encoded = await tryEncode(outW, outH)
    if (encoded) return encoded
    outW = Math.max(1, Math.floor(outW * 0.85))
    outH = Math.max(1, Math.round(outW / TARGET_ASPECT))
  }

  throw new Error(`封面生成失败：压缩后仍超过 ${formatBytes(opts.maxBytes)}`)
}

function isImageFile(file: File | null): file is File {
  return Boolean(file && file.type && file.type.startsWith('image/'))
}

export default function CoverField({ articleId, value, disabled, onChange, onBusyChange }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const [cropOpen, setCropOpen] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null)
  const [cropNatural, setCropNatural] = useState<{ w: number; h: number } | null>(null)
  const [cropZoom, setCropZoom] = useState(1)
  const [cropOffset, setCropOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const cropImgRef = useRef<HTMLImageElement | null>(null)
  const cropFrameRef = useRef<HTMLDivElement | null>(null)
  const [cropFrame, setCropFrame] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  useEffect(() => {
    onBusyChange?.(uploading)
  }, [onBusyChange, uploading])

  useEffect(() => {
    if (!cropOpen) return
    const el = cropFrameRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      setCropFrame({ w: rect.width, h: rect.height })
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => update())
    ro.observe(el)
    return () => ro.disconnect()
  }, [cropOpen])

  const baseScale = useMemo(() => {
    if (!cropNatural?.w || !cropNatural?.h) return 1
    if (!cropFrame.w || !cropFrame.h) return 1
    return Math.max(cropFrame.w / cropNatural.w, cropFrame.h / cropNatural.h)
  }, [cropFrame.h, cropFrame.w, cropNatural?.h, cropNatural?.w])

  const scale = useMemo(() => baseScale * cropZoom, [baseScale, cropZoom])

  const maxOffset = useMemo(() => {
    const iw = cropNatural?.w ?? 0
    const ih = cropNatural?.h ?? 0
    if (!iw || !ih || !cropFrame.w || !cropFrame.h) return { x: 0, y: 0 }
    const dw = iw * scale
    const dh = ih * scale
    return {
      x: Math.max(0, (dw - cropFrame.w) / 2),
      y: Math.max(0, (dh - cropFrame.h) / 2),
    }
  }, [cropFrame.h, cropFrame.w, cropNatural?.h, cropNatural?.w, scale])

  useEffect(() => {
    setCropOffset((prev) => ({
      x: clamp(prev.x, -maxOffset.x, maxOffset.x),
      y: clamp(prev.y, -maxOffset.y, maxOffset.y),
    }))
  }, [maxOffset.x, maxOffset.y])

  useEffect(() => {
    if (!cropPreviewUrl) return
    return () => {
      URL.revokeObjectURL(cropPreviewUrl)
    }
  }, [cropPreviewUrl])

  async function patchCover(next: string | null) {
    const res = await fetch(`/api/articles/${articleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover: next }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = typeof (data as any)?.error === 'string' ? (data as any).error : '保存封面失败'
      throw new Error(msg)
    }
  }

  async function uploadAsset(file: File): Promise<string> {
    const form = new FormData()
    form.set('file', file)
    const res = await fetch('/api/assets', { method: 'POST', body: form })
    const data = (await res.json().catch(() => ({}))) as UploadResult
    if (!res.ok || 'error' in data) {
      if (res.status === 413) {
        const maxBytes = resolveClientAssetMaxBytes()
        throw new Error(`图片过大，请控制在 ${formatBytes(maxBytes)} 以内`)
      }
      throw new Error(('error' in data && data.error) || '上传失败')
    }
    return data.url
  }

  async function setCoverFromFile(file: File, cropOverride?: { sx: number; sy: number; sw: number; sh: number }) {
    setError(null)
    setUploading(true)
    let loaded: Awaited<ReturnType<typeof loadImageFromFile>> | null = null
    try {
      loaded = await loadImageFromFile(file)
      if (!loaded) throw new Error('无法读取图片')
      const maxBytes = resolveClientAssetMaxBytes()
      const crop = cropOverride ?? { sx: 0, sy: 0, sw: loaded.width, sh: loaded.height }
      const processed = await encodeCoverFromCrop({
        img: loaded.img,
        sourceFileName: file.name || 'cover',
        maxBytes,
        crop,
      })

      let url: string | null = null
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          url = await uploadAsset(processed)
          break
        } catch (err: any) {
          const msg = String(err?.message || '')
          if (attempt === 0 && msg.includes('图片过大')) {
            const tighter = Math.max(1_500_000, Math.floor(maxBytes * 0.72))
            const tighterProcessed = await encodeCoverFromCrop({
              img: loaded.img,
              sourceFileName: processed.name || file.name || 'cover',
              maxBytes: tighter,
              crop,
            })
            url = await uploadAsset(tighterProcessed)
            break
          }
          throw err
        }
      }
      if (!url) throw new Error('上传失败')

      await patchCover(url)
      onChange(url)
    } finally {
      if (loaded?.objectUrl) URL.revokeObjectURL(loaded.objectUrl)
      setUploading(false)
    }
  }

  async function onPickFile(nextFile: File) {
    setError(null)
    const loaded = await loadImageFromFile(nextFile)
    const ratio = loaded.width / loaded.height
    const needsCrop = !Number.isFinite(ratio) || Math.abs(ratio - TARGET_ASPECT) > RATIO_TOLERANCE

    if (!needsCrop) {
      URL.revokeObjectURL(loaded.objectUrl)
      await setCoverFromFile(nextFile)
      return
    }

    cropImgRef.current = loaded.img
    setCropFile(nextFile)
    setCropPreviewUrl(loaded.objectUrl)
    setCropNatural({ w: loaded.width, h: loaded.height })
    setCropZoom(1)
    setCropOffset({ x: 0, y: 0 })
    setCropOpen(true)
  }

  function closeCrop() {
    setCropOpen(false)
    setCropFile(null)
    setCropNatural(null)
    cropImgRef.current = null
    setCropZoom(1)
    setCropOffset({ x: 0, y: 0 })
    setCropPreviewUrl(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function openFileDialog() {
    if (disabled || uploading) return
    setError(null)
    inputRef.current?.click()
  }

  async function remove() {
    if (disabled || uploading) return
    setError(null)
    setUploading(true)
    try {
      await patchCover(null)
      onChange(null)
    } catch (err: any) {
      setError(String(err?.message || '移除失败'))
    } finally {
      setUploading(false)
    }
  }

  const dragRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null)

  function onCropPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!cropOpen) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffsetX: cropOffset.x, startOffsetY: cropOffset.y }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  function onCropPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const state = dragRef.current
    if (!state) return
    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY
    setCropOffset({
      x: clamp(state.startOffsetX + dx, -maxOffset.x, maxOffset.x),
      y: clamp(state.startOffsetY + dy, -maxOffset.y, maxOffset.y),
    })
  }

  function onCropPointerUp() {
    dragRef.current = null
  }

  async function confirmCrop() {
    if (!cropFile) return
    if (!cropNatural?.w || !cropNatural?.h) return
    if (!cropFrame.w || !cropFrame.h) return
    const img = cropImgRef.current
    if (!img) return

    setError(null)
    try {
      const cropScale = baseScale * cropZoom
      const sw = cropFrame.w / cropScale
      const sh = cropFrame.h / cropScale
      const sx = (-cropFrame.w / 2 - cropOffset.x) / cropScale + cropNatural.w / 2
      const sy = (-cropFrame.h / 2 - cropOffset.y) / cropScale + cropNatural.h / 2

      await setCoverFromFile(cropFile, { sx, sy, sw, sh })
      closeCrop()
    } catch (err: any) {
      setError(String(err?.message || '上传失败'))
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <label className="block text-sm font-medium">封面（可选）</label>
          <div className="mt-1 text-xs text-gray-500">用于首页书封展示，比例固定为 3:4</div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={openFileDialog} disabled={Boolean(disabled || uploading)}>
            {uploading ? '处理中…' : value ? '更换' : '上传'}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
              onClick={remove}
              disabled={Boolean(disabled || uploading)}
            >
              移除
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex gap-4">
        <div className="w-28 shrink-0">
          <div className="relative aspect-[3/4] overflow-hidden rounded-lg border bg-gray-50">
            {value ? <img src={value} alt="cover preview" className="absolute inset-0 h-full w-full object-cover" /> : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/10 to-transparent" />
            {!value ? <div className="absolute inset-0 grid place-items-center text-xs text-gray-400">暂无封面</div> : null}
          </div>
        </div>
        <div className="min-w-0 flex-1 text-sm text-gray-600">
          <div>建议：主体居中、边缘留白，避免关键内容被裁剪。</div>
          <div className="mt-1">如果图片比例不符合，会弹窗让你裁剪到 3:4。</div>
        </div>
      </div>

      {error ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null
          if (!isImageFile(file)) return
          void onPickFile(file).catch((err: any) => setError(String(err?.message || '读取图片失败')))
        }}
      />

      {cropOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">裁剪封面</h3>
                <p className="mt-1 text-sm text-gray-600">拖动图片调整位置，使用滑块缩放，裁剪结果为 3:4。</p>
              </div>
              <button
                className="shrink-0 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
                onClick={closeCrop}
                disabled={uploading}
              >
                关闭
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-4 md:grid-cols-[1fr,260px] md:items-start">
                <div className="rounded-lg border bg-gray-50 p-3">
                  <div
                    ref={cropFrameRef}
                    className="relative mx-auto aspect-[3/4] w-full max-w-[380px] overflow-hidden rounded-md bg-black"
                    onPointerDown={onCropPointerDown}
                    onPointerMove={onCropPointerMove}
                    onPointerUp={onCropPointerUp}
                    onPointerCancel={onCropPointerUp}
                  >
                    {cropPreviewUrl ? (
                      <img
                        src={cropPreviewUrl}
                        alt="crop"
                        className="absolute left-1/2 top-1/2 max-w-none select-none"
                        draggable={false}
                        style={{
                          transform: `translate(-50%, -50%) translate(${cropOffset.x}px, ${cropOffset.y}px) scale(${scale})`,
                          transformOrigin: 'center',
                          willChange: 'transform',
                        }}
                      />
                    ) : null}
                    <div className="pointer-events-none absolute inset-0 ring-1 ring-white/60" />
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium">缩放</label>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.01}
                      value={cropZoom}
                      onChange={(e) => setCropZoom(Number(e.target.value))}
                      disabled={uploading}
                      className="mt-2 w-full"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button type="button" variant="ghost" onClick={() => setCropZoom(1)} disabled={uploading}>
                      重置缩放
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setCropOffset({ x: 0, y: 0 })}
                      disabled={uploading}
                    >
                      重置位置
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
              <Button type="button" variant="ghost" onClick={closeCrop} disabled={uploading}>
                取消
              </Button>
              <Button type="button" onClick={confirmCrop} disabled={uploading}>
                {uploading ? '处理中…' : '确认裁剪并上传'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
