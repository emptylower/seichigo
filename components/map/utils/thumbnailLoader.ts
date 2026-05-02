import type { GlobalPointFeatureProperties } from '@/components/map/types'
import { normalizePointThumbnailUrl } from '@/components/map/utils/normalizePointThumbnailUrl'
import { loadMapImageWithCandidates } from '@/components/map/utils/loadMapImageWithCandidates'
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
  directRequestTimeoutMs?: number
  proxyRequestTimeoutMs?: number
  onTrackedRequestStart?: (input: {
    slotKey: string
    requestedCandidateUrl: string
    candidateIndex: number
    candidateCount: number
    reuseChain: boolean
    queueWaitMs?: number
  }) => {
    requestUrl: string
    requestId: string
  } | null
  onTrackedRequestTerminal?: (input: {
    handle: { requestUrl: string; requestId: string } | null
    terminalState: 'succeeded' | 'failed' | 'aborted'
    finalUrl: string
    chainTerminal: boolean
    outcome?: string
  }) => void
}

const DEFAULT_MAX_LOADED = 200
const MAX_CONCURRENT_LOADS = 10
const FAILED_RETRY_COOLDOWN_MS = 8_000
const DEFAULT_THUMBNAIL_PROXY_TIMEOUT_MS = 5_000
const IMMEDIATE_RETRY_DELAY_MS = 300
const IMMEDIATE_RETRY_ATTEMPTS = 1

function waitForRetryWindow(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)

    const onAbort = () => {
      globalThis.clearTimeout(timeoutId)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function buildViewportSignature(features: GlobalPointFeatureProperties[]): string {
  return features
    .map((feature) => `${feature.pointId}:${String(feature.imageUrl || '')}`)
    .join('|')
}

function shouldRetryImmediately(error: unknown): boolean {
  const message = String((error as Error | null)?.message || '').trim().toLowerCase()
  return message !== 'timeout'
}

export class ThumbnailLoader {
  private readonly map: MapLike
  private readonly maxLoaded: number
  private readonly firstViewTrackedLimit: number
  private readonly directRequestTimeoutMs?: number
  private readonly proxyRequestTimeoutMs?: number
  private readonly onTrackedRequestStart?: ThumbnailLoaderOptions['onTrackedRequestStart']
  private readonly onTrackedRequestTerminal?: ThumbnailLoaderOptions['onTrackedRequestTerminal']

  private readonly lru = new Map<string, number>()
  private readonly failedAt = new Map<string, number>()
  private accessCounter = 0
  private loadTimes: number[] = []
  private updateQueue: Promise<void> = Promise.resolve()
  private activeUpdateAbortController: AbortController | null = null
  private activeViewportSignature: string | null = null
  private activeViewportConsumers = 0

  constructor(options: ThumbnailLoaderOptions) {
    this.map = options.map
    this.maxLoaded = options.maxLoaded ?? DEFAULT_MAX_LOADED
    this.firstViewTrackedLimit = Math.max(0, options.firstViewTrackedLimit ?? 0)
    this.directRequestTimeoutMs = options.directRequestTimeoutMs
    this.proxyRequestTimeoutMs = options.proxyRequestTimeoutMs ?? DEFAULT_THUMBNAIL_PROXY_TIMEOUT_MS
    this.onTrackedRequestStart = options.onTrackedRequestStart
    this.onTrackedRequestTerminal = options.onTrackedRequestTerminal
  }

  async updateViewport(
    visibleFeatures: GlobalPointFeatureProperties[]
  ): Promise<Set<string>> {
    let snapshot = new Set<string>()
    const viewportSignature = buildViewportSignature(visibleFeatures)
    const sameViewport = this.activeViewportSignature === viewportSignature
      && this.activeUpdateAbortController != null
    if (!sameViewport) {
      this.activeUpdateAbortController?.abort()
      this.activeUpdateAbortController = new AbortController()
      this.activeViewportSignature = viewportSignature
      this.activeViewportConsumers = 0
    }
    const abortController = this.activeUpdateAbortController!
    this.activeViewportConsumers += 1

    const run = async () => {
      if (abortController.signal.aborted) {
        snapshot = new Set(this.lru.keys())
        return
      }
      const seen = new Set<string>()
      const uniqueFeatures: GlobalPointFeatureProperties[] = []
      for (const f of visibleFeatures) {
        if (!seen.has(f.pointId)) {
          seen.add(f.pointId)
          uniqueFeatures.push(f)
        }
      }

      const toLoad: { imageId: string; urls: string[]; tracked: boolean }[] = []
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
        } else {
          if (this.lru.has(imageId) && !imageStillOnMap) {
            this.lru.delete(imageId)
          }
          toLoad.push({ imageId, urls: resolvedUrls, tracked })
        }
      }

      await this.loadBatch(toLoad, abortController.signal)

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
    await queued.finally(() => {
      if (this.activeUpdateAbortController === abortController) {
        this.activeViewportConsumers = Math.max(0, this.activeViewportConsumers - 1)
        if (this.activeViewportConsumers === 0) {
          this.activeUpdateAbortController = null
          this.activeViewportSignature = null
        }
      }
    })
    return snapshot
  }

  private async loadBatch(
    items: { imageId: string; urls: string[]; tracked: boolean }[],
    signal: AbortSignal,
  ): Promise<void> {
    let index = 0

    const next = async (): Promise<void> => {
      while (index < items.length && !signal.aborted) {
        const current = items[index++]
        const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
        let loaded = false
        let lastError: unknown = null

        for (let attempt = 0; attempt <= IMMEDIATE_RETRY_ATTEMPTS && !signal.aborted; attempt += 1) {
          try {
            const result = await loadMapImageWithCandidates({
              map: this.map,
              slotKey: current.imageId,
              urls: current.urls,
              tracked: current.tracked,
              requestLane: 'viewport-thumbnail',
              hostPolicyScope: 'point-thumbnail',
              directRequestTimeoutMs: this.directRequestTimeoutMs,
              proxyRequestTimeoutMs: this.proxyRequestTimeoutMs,
              onTrackedRequestStart: this.onTrackedRequestStart,
              onTrackedRequestTerminal: this.onTrackedRequestTerminal,
              requestSignal: signal,
            })
            this.map.addImage(current.imageId, result.data)
            this.lru.set(current.imageId, ++this.accessCounter)
            this.failedAt.delete(current.imageId)

            const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
            this.loadTimes.push(duration)
            if (this.loadTimes.length > 100) {
              this.loadTimes.shift()
            }

            loaded = true
            break
          } catch (error) {
            if ((error as Error)?.name === 'AbortError' || signal.aborted) {
              return
            }
            lastError = error
            if (attempt >= IMMEDIATE_RETRY_ATTEMPTS || !shouldRetryImmediately(error)) {
              break
            }
            await waitForRetryWindow(signal, IMMEDIATE_RETRY_DELAY_MS).catch((retryError) => {
              lastError = retryError
            })
            if ((lastError as Error | null)?.name === 'AbortError' || signal.aborted) {
              return
            }
          }
        }

        if (!loaded) {
          this.failedAt.set(current.imageId, Date.now())
          // In fast successive updates, a concurrent run may already have
          // inserted the same image. Treat it as loaded in that case.
          if (typeof this.map.hasImage === 'function' && this.map.hasImage(current.imageId)) {
            this.lru.set(current.imageId, ++this.accessCounter)
            this.failedAt.delete(current.imageId)
            continue
          }
          void lastError
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
