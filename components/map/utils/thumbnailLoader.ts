import type { GlobalPointFeatureProperties } from '@/components/map/types'
import { normalizePointThumbnailUrl } from '@/components/map/utils/normalizePointThumbnailUrl'

interface MapLike {
  hasImage(id: string): boolean
  addImage(id: string, data: unknown): void
  removeImage(id: string): void
  loadImage(url: string): Promise<{ data: unknown }>
}

interface ThumbnailLoaderOptions {
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

      if (this.lru.has(imageId)) {
        this.lru.set(imageId, ++this.accessCounter)
      } else {
        toLoad.push({ imageId, url })
      }
    }

    await this.loadBatch(toLoad)

    this.evict()

    return new Set(this.lru.keys())
  }

  private async loadBatch(
    items: { imageId: string; url: string }[]
  ): Promise<void> {
    let index = 0

    const next = async (): Promise<void> => {
      while (index < items.length) {
        const current = items[index++]
        try {
          const result = await this.map.loadImage(current.url)
          this.map.addImage(current.imageId, result.data)
          this.lru.set(current.imageId, ++this.accessCounter)
        } catch {
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
}
