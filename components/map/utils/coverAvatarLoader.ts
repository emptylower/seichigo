import { toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'

export interface MapLike {
  addImage(id: string, data: unknown): void
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

export class CoverAvatarLoader {
  private readonly map: MapLike
  private readonly maxLoaded: number
  private readonly lru = new Map<string, number>()
  private accessCounter = 0

  constructor(options: CoverAvatarLoaderOptions) {
    this.map = options.map
    this.maxLoaded = options.maxLoaded ?? DEFAULT_MAX_LOADED
  }

  async updateViewport(candidates: CoverAvatarCandidate[]): Promise<Set<string>> {
    const seen = new Set<number>()
    const toLoad: { imageId: string; url: string }[] = []

    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.bangumiId) || seen.has(candidate.bangumiId)) continue
      seen.add(candidate.bangumiId)

      const rawCover = String(candidate.coverUrl || '').trim()
      if (!rawCover) continue

      const imageId = `cover-${candidate.bangumiId}`
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

      const safeUrl = toCanvasSafeImageUrl(rawCover, `cover-${candidate.bangumiId}.jpg`)
      if (!safeUrl) continue
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
          this.map.addImage(current.imageId, result.data)
          this.lru.set(current.imageId, ++this.accessCounter)
        } catch {
          // Skip failed images; dots and labels remain as fallback.
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
