export type ActiveFigureImage = { node: any; pos: number | null } | null

export function isValidHref(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('//')) return false
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return true

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  if (!schemeMatch) return false
  const scheme = schemeMatch[1]!.toLowerCase()
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto'
}

export function normalizeHref(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('//')) return null
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase()
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return trimmed
    return null
  }

  if (!/\s/.test(trimmed) && (trimmed.includes('.') || trimmed.includes(':'))) {
    return `https://${trimmed}`
  }
  return null
}

export function normalizePastedHttpUrl(input: string): string | null {
  const trimmed = String(input || '').trim()
  if (!trimmed) return null
  if (/\s/.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function safeHasFocus(editor: any): boolean {
  try {
    return Boolean(editor?.view?.hasFocus?.())
  } catch {
    return false
  }
}

export function resolveActiveFigureImageFromState(state: any): ActiveFigureImage {
  try {
    const selection = state?.selection as any
    const selectionNode = selection?.node
    const selectionFrom = typeof selection?.from === 'number' ? selection.from : null
    const $from = selection?.$from

    if (selectionNode?.type?.name === 'figureImage' && selectionFrom != null) {
      return { node: selectionNode, pos: selectionFrom }
    }

    if (!$from) return null
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth)
      if (node?.type?.name !== 'figureImage') continue
      try {
        return { node, pos: $from.before(depth) }
      } catch {
        return { node, pos: null }
      }
    }
    return null
  } catch {
    return null
  }
}

export function createVirtualElementFromDom(el: Element | null) {
  if (!el || !(el instanceof HTMLElement)) return null
  return {
    getBoundingClientRect: () => el.getBoundingClientRect(),
    getClientRects: () => [el.getBoundingClientRect()],
  }
}

export function resolveClientAssetMaxBytes(): number {
  const fallback = 3_500_000
  const raw = process.env.NEXT_PUBLIC_ASSET_MAX_BYTES
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

export function formatBytes(bytes: number): string {
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

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('无法读取图片'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
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

export async function compressImageIfNeeded(file: File, maxBytes: number): Promise<File> {
  if (file.size <= maxBytes) return file
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/gif') {
    throw new Error(`GIF 过大（${formatBytes(file.size)}），请先压缩后再上传`)
  }

  const img = await loadImageFromFile(file)
  const srcW = img.naturalWidth || img.width
  const srcH = img.naturalHeight || img.height
  if (!srcW || !srcH) throw new Error('无法读取图片尺寸')

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  let maxDim = 2560
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
    const dstW = Math.max(1, Math.round(srcW * scale))
    const dstH = Math.max(1, Math.round(srcH * scale))
    canvas.width = dstW
    canvas.height = dstH
    ctx.clearRect(0, 0, dstW, dstH)
    ctx.drawImage(img, 0, 0, dstW, dstH)

    const mimeCandidates = ['image/webp', 'image/jpeg'] as const
    for (const mime of mimeCandidates) {
      for (let q = 0.9; q >= 0.55; q -= 0.1) {
        const blob = await canvasToBlob(canvas, mime, q)
        if (!blob) continue
        if (blob.size <= maxBytes) {
          const name = fileNameForMime(file.name || 'image', blob.type || mime)
          return new File([blob], name, { type: blob.type || mime, lastModified: file.lastModified })
        }
      }
    }

    maxDim = Math.max(800, Math.floor(maxDim * 0.82))
  }

  throw new Error(`图片过大（${formatBytes(file.size)}），压缩后仍超过 ${formatBytes(maxBytes)}`)
}

export function resolveImageInsertPos(editor: any): number {
  try {
    const sel = editor?.state?.selection as any
    if (!sel) return 0

    if (sel?.node?.type?.name === 'figureImage') {
      return typeof sel.to === 'number' ? sel.to : 0
    }

    const $from = sel?.$from
    if ($from) {
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth)
        if (node?.type?.name !== 'figureImage') continue
        try {
          return $from.after(depth)
        } catch {
          // continue
        }
      }
    }

    return typeof sel.to === 'number' ? sel.to : 0
  } catch {
    return 0
  }
}
