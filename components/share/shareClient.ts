import type { SupportedLocale } from '@/lib/i18n/types'
import type {
  CreateShareLinkRequest,
  CreateShareLinkResponse,
  PointContextResponse,
  ShareCardLayout,
  ShareUploadResponse,
} from '@/lib/share/types'
import { isShareCardLayout } from '@/lib/share/types'

export const LAYOUT_STORAGE_KEY = 'seichigo.share.layout'

export async function createShareLink(
  input: CreateShareLinkRequest,
): Promise<CreateShareLinkResponse | null> {
  try {
    const res = await fetch('/api/share/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) return null
    return (await res.json()) as CreateShareLinkResponse
  } catch {
    return null
  }
}

/** 上传失败（未登录 401、限流 429、无绑定 503）都只返回 null：匿名分享照常走 */
export async function uploadShareAssets(
  code: string,
  card: Blob,
  photo: File | null,
): Promise<ShareUploadResponse | null> {
  try {
    const form = new FormData()
    form.set('card', new File([card], `${code}.jpg`, { type: card.type || 'image/jpeg' }))
    if (photo) form.set('photo', photo)
    const res = await fetch(`/api/share/links/${code}/upload`, { method: 'POST', body: form })
    if (!res.ok) return null
    return (await res.json()) as ShareUploadResponse
  } catch {
    return null
  }
}

export function readPreferredLayout(): ShareCardLayout {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_STORAGE_KEY)
    return isShareCardLayout(raw) ? raw : 'portrait'
  } catch {
    return 'portrait'
  }
}

export function writePreferredLayout(layout: ShareCardLayout): void {
  try {
    globalThis.localStorage?.setItem(LAYOUT_STORAGE_KEY, layout)
  } catch {
    // 隐私模式下写不进去，忽略
  }
}

export function canShareFiles(files: File[]): boolean {
  const nav = globalThis.navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (typeof nav?.share !== 'function') return false
  if (typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare({ files })
  } catch {
    return false
  }
}

export async function shareViaSystem(input: {
  files: File[]
  text: string
  url: string
}): Promise<'files' | 'text' | 'failed'> {
  const nav = globalThis.navigator
  if (typeof nav?.share !== 'function') return 'failed'
  try {
    if (canShareFiles(input.files)) {
      await nav.share({ files: input.files, text: input.text, url: input.url })
      return 'files'
    }
    await nav.share({ text: input.text, url: input.url })
    return 'text'
  } catch {
    return 'failed'
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await globalThis.navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** ClipboardItem 只接受 image/png，所以先把 JPEG 过一遍 canvas 转 PNG */
export async function copyImage(blob: Blob): Promise<boolean> {
  const ClipboardItemCtor = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
  if (!ClipboardItemCtor || typeof globalThis.navigator?.clipboard?.write !== 'function') return false
  try {
    const png = blob.type === 'image/png' ? blob : await toPngBlob(blob)
    if (!png) return false
    await globalThis.navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': png })])
    return true
  } catch {
    return false
  }
}

async function toPngBlob(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('decode failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(image, 0, 0)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // 立刻 revoke 会让部分浏览器下载空文件，延后一拍
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function blobToFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type || 'image/jpeg' })
}

/**
 * 非 JPEG/PNG/WebP 的实拍（典型是 iPhone 的 HEIC）转一道 JPEG 再上传；
 * 解码/绘制失败返回 null，由调用方提示格式不支持。
 */
export async function transcodeToJpeg(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return null
    }
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  } catch {
    return null
  }
}

/**
 * 点位上下文（地址 / 说明 / 去前缀点位名 / 是否在日本）。
 * 与建短链并行发，失败返回 null —— 卡片按无地址无说明画，不阻塞分享。
 */
export async function fetchPointContext(
  pointId: string,
  locale: SupportedLocale,
): Promise<PointContextResponse | null> {
  try {
    const params = new URLSearchParams({ pointId, locale })
    const res = await fetch(`/api/share/point-context?${params.toString()}`)
    if (!res.ok) return null
    return (await res.json()) as PointContextResponse
  } catch {
    return null
  }
}

/**
 * 在 click 的同步链路里先把窗口开出来。
 * 之后 `await` 剪贴板写入再改 `location`，否则 await 之后的 open 会被弹窗拦截。
 */
export function openBlankWindow(): Window | null {
  try {
    return globalThis.open?.('about:blank') ?? null
  } catch {
    return null
  }
}

/** 有引用就先断 opener 再改它的 location；没有（同步 open 就被拦了）再赌一次 open，仍失败返回 false */
export function openOrNavigate(win: Window | null, url: string): boolean {
  if (win) {
    try {
      // 跨域窗口赋 opener 可能抛，断开失败不挡导航
      try {
        win.opener = null
      } catch {
        // 忽略
      }
      win.location.href = url
      return true
    } catch {
      // 引用作废（被浏览器回收），落到下面兜底
    }
  }
  try {
    // 不用 'noopener' 特性串：部分浏览器（含 in-app webview）见到特性串直接拦掉。
    // 手动断 opener 达到同样的隔离效果
    const w = globalThis.open?.(url, '_blank')
    if (!w) return false
    try {
      w.opener = null
    } catch {
      // 忽略
    }
    return true
  } catch {
    return false
  }
}
