import type { GlobalPointFeatureProperties } from '@/components/map/types'
import { normalizePointThumbnailUrl } from '@/components/map/utils/normalizePointThumbnailUrl'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'

export interface MapLike {
  addImage(id: string, data: unknown): void
  removeImage(id: string): void
  loadImage(url: string): Promise<{ data: unknown }>
  hasImage?(id: string): boolean
}

export interface ThumbnailLoaderOptions {
  map: MapLike
  maxLoaded?: number
  firstViewTrackedLimit?: number
  onTrackedSlotRequestStart?: (input: { slotKey: string; src: string }) => void
  onTrackedSlotSettle?: (input: { slotKey: string; src: string; state: 'visible' | 'fallback' }) => void
}

const DEFAULT_MAX_LOADED = 200
const MAX_CONCURRENT_LOADS = 10
const FAILED_RETRY_COOLDOWN_MS = 8_000

export class ThumbnailLoader {
  private readonly map: MapLike
  private readonly maxLoaded: number
  private readonly firstViewTrackedLimit: number
  private readonly onTrackedSlotRequestStart?: (input: { slotKey: string; src: string }) => void
  private readonly onTrackedSlotSettle?: (input: { slotKey: string; src: string; state: 'visible' | 'fallback' }) => void

  private readonly lru = new Map<string, number>()
  private readonly failedAt = new Map<string, number>()
  private accessCounter = 0
  private loadTimes: number[] = []
  private updateQueue: Promise<void> = Promise.resolve()

  constructor(options: ThumbnailLoaderOptions) {
    this.map = options.map
    this.maxLoaded = options.maxLoaded ?? DEFAULT_MAX_LOADED
    this.firstViewTrackedLimit = Math.max(0, options.firstViewTrackedLimit ?? 0)
    this.onTrackedSlotRequestStart = options.onTrackedSlotRequestStart
    this.onTrackedSlotSettle = options.onTrackedSlotSettle
  }

  async updateViewport(
    visibleFeatures: GlobalPointFeatureProperties[]
  ): Promise<Set<string>> {
    let snapshot = new Set<string>()

    const run = async () => {
      const seen = new Set<string>()
      const uniqueFeatures: GlobalPointFeatureProperties[] = []
      for (const f of visibleFeatures) {
        if (!seen.has(f.pointId)) {
          seen.add(f.pointId)
          uniqueFeatures.push(f)
        }
      }

      const toLoad: { imageId: string; url: string; urls: string[]; tracked: boolean }[] = []
      const now = Date.now()
      let visibleIndex = 0

      for (const feature of uniqueFeatures) {
        const url = normalizePointThumbnailUrl(feature.imageUrl)
        if (!url) continue
        const urls = getMapDisplayImageCandidates(String(feature.imageUrl || '').trim(), { kind: 'point-thumbnail' })
        const resolvedUrls = urls.length > 0 ? urls : [url]

        const imageId = `thumb-${feature.pointId}`
        const tracked = visibleIndex < this.firstViewTrackedLimit
        visibleIndex += 1
        const failedAt = this.failedAt.get(imageId)
        if (failedAt != null && now - failedAt < FAILED_RETRY_COOLDOWN_MS) {
          if (tracked) {
            this.onTrackedSlotSettle?.({ slotKey: imageId, src: url, state: 'fallback' })
          }
          continue
        }
        if (failedAt != null) {
          this.failedAt.delete(imageId)
        }

        const imageStillOnMap = typeof this.map.hasImage === 'function'
          ? this.map.hasImage(imageId)
          : true
        if (this.lru.has(imageId) && imageStillOnMap) {
          this.lru.set(imageId, ++this.accessCounter)
          if (tracked) {
            this.onTrackedSlotSettle?.({ slotKey: imageId, src: url, state: 'visible' })
          }
        } else {
          if (this.lru.has(imageId) && !imageStillOnMap) {
            this.lru.delete(imageId)
          }
          toLoad.push({ imageId, url, urls: resolvedUrls, tracked })
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

      snapshot = new Set(this.lru.keys())
    }

    const queued = this.updateQueue.then(run, run)
    this.updateQueue = queued.then(() => undefined, () => undefined)
    await queued
    return snapshot
  }

  private async loadBatch(
    items: { imageId: string; url: string; urls: string[]; tracked: boolean }[]
  ): Promise<void> {
    let index = 0

    const next = async (): Promise<void> => {
      while (index < items.length) {
        const current = items[index++]
        const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
        try {
          if (current.tracked) {
            this.onTrackedSlotRequestStart?.({ slotKey: current.imageId, src: current.url })
          }
          let result: { data: unknown } | null = null
          let finalUrl = current.url
          let lastError: unknown = null
          for (const candidateUrl of current.urls) {
            finalUrl = candidateUrl
            try {
              result = await this.map.loadImage(candidateUrl)
              break
            } catch (error) {
              lastError = error
            }
          }
          if (!result) {
            throw lastError || new Error('load failed')
          }
          this.map.addImage(current.imageId, result.data)
          this.lru.set(current.imageId, ++this.accessCounter)
          this.failedAt.delete(current.imageId)
          if (current.tracked) {
            this.onTrackedSlotSettle?.({ slotKey: current.imageId, src: finalUrl, state: 'visible' })
          }

          // Track load duration
          const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
          this.loadTimes.push(duration)
          if (this.loadTimes.length > 100) {
            this.loadTimes.shift()
          }
        } catch {
          this.failedAt.set(current.imageId, Date.now())
          // In fast successive updates, a concurrent run may already have
          // inserted the same image. Treat it as loaded in that case.
          if (typeof this.map.hasImage === 'function' && this.map.hasImage(current.imageId)) {
            this.lru.set(current.imageId, ++this.accessCounter)
            this.failedAt.delete(current.imageId)
            if (current.tracked) {
              this.onTrackedSlotSettle?.({ slotKey: current.imageId, src: current.url, state: 'visible' })
            }
            continue
          }
          if (current.tracked) {
            this.onTrackedSlotSettle?.({ slotKey: current.imageId, src: current.url, state: 'fallback' })
          }
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
