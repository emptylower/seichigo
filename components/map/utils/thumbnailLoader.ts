import type { GlobalPointFeatureProperties } from '@/components/map/types'
import { normalizePointThumbnailUrl } from '@/components/map/utils/normalizePointThumbnailUrl'

export interface MapLike {
  addImage(id: string, data: unknown): void
  removeImage(id: string): void
  loadImage(url: string): Promise<{ data: unknown }>
  hasImage?(id: string): boolean
}

export interface ThumbnailLoaderOptions {
  map: MapLike
  maxLoaded?: number
}

const DEFAULT_MAX_LOADED = 200
const MAX_CONCURRENT_LOADS = 10

export class ThumbnailLoader {
  private readonly map: MapLike
  private readonly maxLoaded: number

  private readonly lru = new Map<string, number>()
  private accessCounter = 0
  private loadTimes: number[] = []

  constructor(options: ThumbnailLoaderOptions) {
    this.map = options.map
    this.maxLoaded = options.maxLoaded ?? DEFAULT_MAX_LOADED
  }

  async updateViewport(
    visibleFeatures: GlobalPointFeatureProperties[]
  ): Promise<Set<string>> {
    const seen = new Set<string>()
    const uniqueFeatures: GlobalPointFeatureProperties[] = []
    for (const f of visibleFeatures) {
      if (!seen.has(f.pointId)) {
        seen.add(f.pointId)
        uniqueFeatures.push(f)
      }
    }

    const toLoad: { imageId: string; url: string }[] = []

    for (const feature of uniqueFeatures) {
      const url = normalizePointThumbnailUrl(feature.imageUrl)
      if (!url) continue

      const imageId = `thumb-${feature.pointId}`

      const imageStillOnMap = typeof this.map.hasImage === 'function'
        ? this.map.hasImage(imageId)
        : true
      if (this.lru.has(imageId) && imageStillOnMap) {
        this.lru.set(imageId, ++this.accessCounter)
      } else {
        if (this.lru.has(imageId) && !imageStillOnMap) {
          this.lru.delete(imageId)
        }
        toLoad.push({ imageId, url })
      }
    }

    await this.loadBatch(toLoad)

    this.evict()

    // Log when cap is reached
    if (this.lru.size >= this.maxLoaded) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug(`[ThumbnailLoader] Cap reached: ${this.lru.size}/${this.maxLoaded}`)
      }
    }

    // Memory guard (Chrome only)
    if (this.lru.size > 100 && typeof performance !== 'undefined' && (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory) {
      const mem = (performance as unknown as { memory: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
      if (typeof console !== 'undefined' && console.debug) {
        console.debug(`[ThumbnailLoader] Heap: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(mem.jsHeapSizeLimit / 1024 / 1024).toFixed(1)}MB`)
      }
    }

    return new Set(this.lru.keys())
  }

  private async loadBatch(
    items: { imageId: string; url: string }[]
  ): Promise<void> {
    let index = 0

    const next = async (): Promise<void> => {
      while (index < items.length) {
        const current = items[index++]
        const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
        try {
          const result = await this.map.loadImage(current.url)
          this.map.addImage(current.imageId, result.data)
          this.lru.set(current.imageId, ++this.accessCounter)

          // Track load duration
          const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
          this.loadTimes.push(duration)
          if (this.loadTimes.length > 100) {
            this.loadTimes.shift()
          }
        } catch {
          // Failed loads are silently skipped
        }
      }
    }

    const workers = Math.min(MAX_CONCURRENT_LOADS, items.length)
    const promises: Promise<void>[] = []
    for (let i = 0; i < workers; i++) {
      promises.push(next())
    }
    await Promise.all(promises)
  }

  private evict(): void {
    if (this.lru.size <= this.maxLoaded) return

    const entries = [...this.lru.entries()].sort((a, b) => a[1] - b[1])
    const toEvict = entries.slice(0, this.lru.size - this.maxLoaded)

    for (const [imageId] of toEvict) {
      this.map.removeImage(imageId)
      this.lru.delete(imageId)
    }
  }

  /** Get performance statistics for monitoring */
  getStats(): { avg: number; p95: number; count: number } {
    if (this.loadTimes.length === 0) {
      return { avg: 0, p95: 0, count: this.lru.size }
    }

    const sorted = [...this.loadTimes].sort((a, b) => a - b)
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length
    const p95Index = Math.floor(sorted.length * 0.95)
    const p95 = sorted[p95Index] ?? 0

    return { avg, p95, count: this.lru.size }
  }
}
