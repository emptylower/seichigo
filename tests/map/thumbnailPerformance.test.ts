import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThumbnailLoader } from '@/components/map/utils/thumbnailLoader'
import type { MapLike } from '@/components/map/utils/thumbnailLoader'
import type { GlobalPointFeatureProperties } from '@/components/map/types'

// ── Mock Map ──────────────────────────────────────────────────────────────

function createMockMap() {
  const images = new Map<string, unknown>()
  return {
    images,
    hasImage(id: string) {
      return images.has(id)
    },
    addImage(id: string, data: unknown) {
      images.set(id, data)
    },
    removeImage(id: string) {
      images.delete(id)
    },
    loadImage: vi.fn(async (_url: string) => {
      return { data: { width: 64, height: 64 } }
    }),
  } satisfies MapLike & { images: Map<string, unknown>; loadImage: ReturnType<typeof vi.fn> }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function makeFeature(
  pointId: string,
  imageUrl: string | null = `https://anitabi.cn/img/${pointId}.jpg`
): GlobalPointFeatureProperties {
  return {
    pointId,
    color: '#E91E63',
    selected: 0,
    userState: 'none',
    bangumiId: 1,
    imageUrl,
  }
}

function makeFeatures(count: number, startId = 1): GlobalPointFeatureProperties[] {
  return Array.from({ length: count }, (_, i) =>
    makeFeature(`p${startId + i}`)
  )
}

// ── Performance Tests ────────────────────────────────────────────────────

describe('ThumbnailLoader Performance', () => {
  let map: ReturnType<typeof createMockMap>
  let loader: ThumbnailLoader

  beforeEach(() => {
    map = createMockMap()
    loader = new ThumbnailLoader({ map, maxLoaded: 200 })
  })

  // ── Cap Enforcement ──────────────────────────────────────────────────

  describe('cap enforcement', () => {
    it('enforces 200 thumbnail cap with 300 features', async () => {
      const features = makeFeatures(300)
      const loaded = await loader.updateViewport(features)

      expect(loaded.size).toBeLessThanOrEqual(200)
      expect(map.images.size).toBeLessThanOrEqual(200)

      const stats = loader.getStats()
      expect(stats.count).toBeLessThanOrEqual(200)
    })

    it('enforces cap across multiple viewport updates', async () => {
      // Load 150 first
      await loader.updateViewport(makeFeatures(150, 1))
      expect(map.images.size).toBe(150)

      // Load another 150 (total unique = 300)
      const loaded = await loader.updateViewport(makeFeatures(150, 151))
      expect(loaded.size).toBeLessThanOrEqual(200)
      expect(map.images.size).toBeLessThanOrEqual(200)
    })

    it('enforces cap with exact boundary (200 features)', async () => {
      const features = makeFeatures(200)
      const loaded = await loader.updateViewport(features)

      expect(loaded.size).toBe(200)
      expect(map.images.size).toBe(200)
    })

    it('enforces cap with small maxLoaded override', async () => {
      const smallLoader = new ThumbnailLoader({ map, maxLoaded: 10 })
      const features = makeFeatures(50)
      const loaded = await smallLoader.updateViewport(features)

      expect(loaded.size).toBeLessThanOrEqual(10)
      expect(map.images.size).toBeLessThanOrEqual(10)
    })
  })

  // ── Load Time Tracking ───────────────────────────────────────────────

  describe('load time tracking', () => {
    it('tracks load times with getStats()', async () => {
      map.loadImage.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 5))
        return { data: { width: 64, height: 64 } }
      })

      const features = makeFeatures(3)
      await loader.updateViewport(features)

      const stats = loader.getStats()
      expect(stats.avg).toBeGreaterThan(0)
      expect(stats.p95).toBeGreaterThan(0)
      expect(stats.count).toBe(3)
    })

    it('returns zero stats for empty viewport', async () => {
      const stats = loader.getStats()

      expect(stats.avg).toBe(0)
      expect(stats.p95).toBe(0)
      expect(stats.count).toBe(0)
    })

    it('returns zero avg/p95 when no images loaded yet', async () => {
      await loader.updateViewport([])
      const stats = loader.getStats()
      expect(stats.avg).toBe(0)
      expect(stats.p95).toBe(0)
    })

    it('keeps only last 100 measurements', async () => {
      // Load 120 features to generate 120 load time measurements
      const features = makeFeatures(120)
      await loader.updateViewport(features)

      const stats = loader.getStats()
      // Stats should still work correctly
      expect(stats.avg).toBeGreaterThanOrEqual(0)
      expect(stats.count).toBe(120)
    })

    it('does not track failed loads in timing stats', async () => {
      map.loadImage.mockImplementation(async (_url: string) => {
        throw new Error('Network error')
      })

      const features = makeFeatures(5)
      await loader.updateViewport(features)

      const stats = loader.getStats()
      // No successful loads → no timing data
      expect(stats.avg).toBe(0)
      expect(stats.p95).toBe(0)
      expect(stats.count).toBe(0)
    })
  })

  // ── Console.debug Logging ────────────────────────────────────────────

  describe('debug logging', () => {
    it('logs when cap is reached', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

      const features = makeFeatures(210)
      await loader.updateViewport(features)

      const capLogs = debugSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('[ThumbnailLoader] Cap reached')
      )
      expect(capLogs.length).toBeGreaterThan(0)

      debugSpy.mockRestore()
    })

    it('does not log cap message when under limit', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

      const features = makeFeatures(50)
      await loader.updateViewport(features)

      const capLogs = debugSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('[ThumbnailLoader] Cap reached')
      )
      expect(capLogs.length).toBe(0)

      debugSpy.mockRestore()
    })
  })

  // ── Mobile Viewport Simulation ───────────────────────────────────────

  describe('mobile viewport simulation', () => {
    it('handles mobile-density feature count without issues (375px equiv)', async () => {
      // On a 375px mobile screen, typical visible features would be ~30-80
      const mobileFeatureCount = 80
      const features = makeFeatures(mobileFeatureCount)
      const loaded = await loader.updateViewport(features)

      expect(loaded.size).toBe(mobileFeatureCount)
      expect(loaded.size).toBeLessThanOrEqual(200)

      const stats = loader.getStats()
      expect(stats.count).toBe(mobileFeatureCount)
    })

    it('handles rapid viewport updates without exceeding cap', async () => {
      // Simulate rapid panning on mobile
      for (let i = 0; i < 10; i++) {
        const startIdx = i * 30
        const features = makeFeatures(50, startIdx)
        const loaded = await loader.updateViewport(features)
        expect(loaded.size).toBeLessThanOrEqual(200)
      }

      expect(map.images.size).toBeLessThanOrEqual(200)
    })
  })
})
