import { toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'

export interface MapLike {
  addImage(id: string, data: unknown, options?: { pixelRatio?: number }): void
  removeImage(id: string): void
  loadImage(url: string): Promise<{ data: unknown }>
  hasImage?(id: string): boolean
}

export type CoverAvatarCandidate = {
  bangumiId: number
  coverUrl: string | null
}

export interface CoverAvatarLoaderOptions {
  map: MapLike
  maxLoaded?: number
}

const DEFAULT_MAX_LOADED = 160
const MAX_CONCURRENT_LOADS = 6
const FAILED_RETRY_COOLDOWN_MS = 180_000
const AVATAR_SIZE = 72
const AVATAR_BORDER = 3
const EXTRA_ALLOWED_COVER_HOSTS = ['anitabi.cn', 'bgm.tv']

export class CoverAvatarLoader {
  private readonly map: MapLike
  private readonly maxLoaded: number
  private readonly lru = new Map<string, number>()
  private readonly failedAt = new Map<string, number>()
  private readonly loading = new Set<string>()
  private accessCounter = 0

  constructor(options: CoverAvatarLoaderOptions) {
    this.map = options.map
    this.maxLoaded = options.maxLoaded ?? DEFAULT_MAX_LOADED
  }

  async updateViewport(candidates: CoverAvatarCandidate[]): Promise<Set<string>> {
    const seen = new Set<number>()
    const toLoad: { imageId: string; url: string }[] = []
    const now = Date.now()
    const candidateLimit = Math.max(1, this.maxLoaded)

    for (const candidate of candidates) {
      if (seen.size >= candidateLimit) break
      if (!Number.isFinite(candidate.bangumiId) || seen.has(candidate.bangumiId)) continue
      seen.add(candidate.bangumiId)

      const rawCover = this.normalizeCoverUrl(String(candidate.coverUrl || '').trim())
      if (!rawCover) continue
      if (!this.isAllowedCoverHost(rawCover)) continue

      const imageId = `cover-${candidate.bangumiId}`
      const failedAt = this.failedAt.get(imageId)
      if (failedAt && now - failedAt < FAILED_RETRY_COOLDOWN_MS) continue
      if (failedAt) this.failedAt.delete(imageId)
      const imageStillOnMap = typeof this.map.hasImage === 'function'
        ? this.map.hasImage(imageId)
        : true
      if (this.lru.has(imageId) && imageStillOnMap) {
        this.lru.set(imageId, ++this.accessCounter)
        continue
      }
      if (this.lru.has(imageId) && !imageStillOnMap) {
        this.lru.delete(imageId)
      }
      if (this.loading.has(imageId)) continue

      const safeUrl = toCanvasSafeImageUrl(rawCover, `cover-${candidate.bangumiId}.jpg`)
      if (!safeUrl) continue
      this.loading.add(imageId)
      toLoad.push({ imageId, url: safeUrl })
    }

    await this.loadBatch(toLoad)
    this.evict()
    return new Set(this.lru.keys())
  }

  private async loadBatch(items: Array<{ imageId: string; url: string }>): Promise<void> {
    let index = 0

    const worker = async (): Promise<void> => {
      while (index < items.length) {
        const current = items[index++]
        try {
          const result = await this.map.loadImage(current.url)
          const existsOnMap = typeof this.map.hasImage === 'function' ? this.map.hasImage(current.imageId) : false
          if (!existsOnMap) {
            const avatarData = this.toAvatarImageData(result.data)
            if (avatarData) {
              this.map.addImage(current.imageId, avatarData, { pixelRatio: 1 })
            } else {
              this.map.addImage(current.imageId, result.data)
            }
          }
          this.lru.set(current.imageId, ++this.accessCounter)
          this.failedAt.delete(current.imageId)
        } catch {
          this.failedAt.set(current.imageId, Date.now())
          // Skip failed images; dots and labels remain as fallback.
        } finally {
          this.loading.delete(current.imageId)
        }
      }
    }

    const workers = Math.min(MAX_CONCURRENT_LOADS, items.length)
    const jobs: Promise<void>[] = []
    for (let i = 0; i < workers; i += 1) {
      jobs.push(worker())
    }
    await Promise.all(jobs)
  }

  private normalizeCoverUrl(raw: string): string {
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (raw.startsWith('/')) return `https://www.anitabi.cn${raw}`
    return raw
  }

  private isAllowedCoverHost(raw: string): boolean {
    try {
      const url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com')
      const host = url.hostname.trim().toLowerCase()
      if (!host) return false
      if (typeof window !== 'undefined') {
        const currentHost = window.location.hostname.trim().toLowerCase()
        if (host === currentHost || host.endsWith(`.${currentHost}`)) return true
      }
      return EXTRA_ALLOWED_COVER_HOSTS.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`))
    } catch {
      return false
    }
  }

  private toAvatarImageData(input: unknown): ImageData | null {
    if (typeof document === 'undefined') return null
    const source = this.toCanvasImageSource(input)
    if (!source) return null

    const sourceWidth = Number((source as { width?: unknown }).width || 0)
    const sourceHeight = Number((source as { height?: unknown }).height || 0)
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
      return null
    }

    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const minSide = Math.min(sourceWidth, sourceHeight)
    const sx = (sourceWidth - minSide) / 2
    const sy = (sourceHeight - minSide) / 2
    const innerSize = AVATAR_SIZE - AVATAR_BORDER * 2
    const radius = innerSize / 2
    const center = AVATAR_SIZE / 2

    ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(center, center, center - 1, 0, Math.PI * 2)
    ctx.fill()

    ctx.save()
    ctx.beginPath()
    ctx.arc(center, center, radius, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(
      source,
      sx,
      sy,
      minSide,
      minSide,
      AVATAR_BORDER,
      AVATAR_BORDER,
      innerSize,
      innerSize,
    )
    ctx.restore()

    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'
    ctx.beginPath()
    ctx.arc(center, center, radius, 0, Math.PI * 2)
    ctx.stroke()

    return ctx.getImageData(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  }

  private toCanvasImageSource(input: unknown): CanvasImageSource | null {
    if (typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap) {
      return input
    }
    if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
      return input
    }
    if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
      return input
    }
    if (typeof OffscreenCanvas !== 'undefined' && input instanceof OffscreenCanvas) {
      return input
    }
    if (typeof ImageData !== 'undefined' && input instanceof ImageData && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = input.width
      canvas.height = input.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.putImageData(input, 0, 0)
      return canvas
    }
    return null
  }

  private evict(): void {
    if (this.lru.size <= this.maxLoaded) return
    const sorted = [...this.lru.entries()].sort((a, b) => a[1] - b[1])
    const removeCount = this.lru.size - this.maxLoaded
    for (const [imageId] of sorted.slice(0, removeCount)) {
      this.map.removeImage(imageId)
      this.lru.delete(imageId)
    }
  }
}
