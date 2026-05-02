import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThumbnailLoader } from '@/components/map/utils/thumbnailLoader'
import { resetDegradedMapImageHostsForTest } from '@/components/map/utils/mapImageHostPolicy'
import { resetMapImageRequestSchedulerForTest } from '@/features/map/anitabi/mapImageRequestScheduler'
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
    loadImage: vi.fn(async (url: string) => {
      return { data: { width: 64, height: 64, url } }
    }),
  }
}

type MockMap = ReturnType<typeof createMockMap>

// ── Helpers ───────────────────────────────────────────────────────────────

function makeFeature(
  pointId: string,
  imageUrl: string | null = `https://anitabi.cn/img/${pointId}.jpg`
): GlobalPointFeatureProperties {
  return {
    pointId,
    color: '#ff0000',
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

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ThumbnailLoader', () => {
  let map: MockMap
  let loader: ThumbnailLoader

  beforeEach(() => {
    resetDegradedMapImageHostsForTest()
    resetMapImageRequestSchedulerForTest()
    map = createMockMap()
    loader = new ThumbnailLoader({ map: map as any, maxLoaded: 200 })
  })

  // 1. Basic construction
  it('should construct with default maxLoaded of 200', () => {
    const defaultLoader = new ThumbnailLoader({ map: map as any })
    expect(defaultLoader).toBeDefined()
  })

  // 2. Load images for visible features
  it('should load images for visible features', async () => {
    const features = makeFeatures(3)
    const loaded = await loader.updateViewport(features)

    expect(loaded.size).toBe(3)
    expect(loaded.has('thumb-p1')).toBe(true)
    expect(loaded.has('thumb-p2')).toBe(true)
    expect(loaded.has('thumb-p3')).toBe(true)
    expect(map.images.size).toBe(3)
  })

  // 3. Skip features with null imageUrl
  it('should skip features with null imageUrl', async () => {
    const features = [
      makeFeature('p1', null),
      makeFeature('p2', 'https://example.com/img.jpg'),
    ]
    const loaded = await loader.updateViewport(features)

    expect(loaded.size).toBe(1)
    expect(loaded.has('thumb-p2')).toBe(true)
    expect(loaded.has('thumb-p1')).toBe(false)
  })

  // 4. No-op for already-loaded images
  it('should not reload already-loaded images', async () => {
    const features = makeFeatures(2)
    await loader.updateViewport(features)
    map.loadImage.mockClear()

    // Same features again
    const loaded = await loader.updateViewport(features)
    expect(loaded.size).toBe(2)
    // Should not have called loadImage again
    expect(map.loadImage).not.toHaveBeenCalled()
  })

  // 5. Cap enforcement: loading 250 features only keeps 200
  it('should enforce maxLoaded cap (250 features → 200 loaded)', async () => {
    const smallLoader = new ThumbnailLoader({ map: map as any, maxLoaded: 200 })
    const features = makeFeatures(250)
    const loaded = await smallLoader.updateViewport(features)

    expect(loaded.size).toBeLessThanOrEqual(200)
    expect(map.images.size).toBeLessThanOrEqual(200)
  })

  // 6. LRU eviction removes oldest-viewed first
  it('should evict oldest-viewed images when cap is exceeded', async () => {
    const smallLoader = new ThumbnailLoader({ map: map as any, maxLoaded: 5 })

    // Load 5 images
    const batch1 = makeFeatures(5, 1)
    await smallLoader.updateViewport(batch1)
    expect(map.images.size).toBe(5)

    // Now view features 3-7 (keep 3,4,5 recent; add 6,7 → need to evict 1,2)
    const batch2 = makeFeatures(5, 3)
    const loaded = await smallLoader.updateViewport(batch2)

    expect(loaded.size).toBe(5)
    // p1 and p2 should be evicted (oldest)
    expect(map.images.has('thumb-p1')).toBe(false)
    expect(map.images.has('thumb-p2')).toBe(false)
    // p3-p7 should be present
    expect(map.images.has('thumb-p3')).toBe(true)
    expect(map.images.has('thumb-p6')).toBe(true)
    expect(map.images.has('thumb-p7')).toBe(true)
  })

  // 7. LRU updates access order on re-view
  it('should update LRU order when features are re-viewed', async () => {
    const smallLoader = new ThumbnailLoader({ map: map as any, maxLoaded: 3 })

    // Load p1, p2, p3
    await smallLoader.updateViewport(makeFeatures(3, 1))

    // Re-view only p1 (makes p1 most recent, p2/p3 older)
    await smallLoader.updateViewport([makeFeature('p1')])

    // Add p4, p5 → need to evict 2 → should evict p2, p3 (not p1)
    await smallLoader.updateViewport([
      makeFeature('p1'),
      makeFeature('p4'),
      makeFeature('p5'),
    ])

    expect(map.images.has('thumb-p1')).toBe(true)
    expect(map.images.has('thumb-p4')).toBe(true)
    expect(map.images.has('thumb-p5')).toBe(true)
    expect(map.images.has('thumb-p2')).toBe(false)
    expect(map.images.has('thumb-p3')).toBe(false)
  })

  // 8. Graceful handling of image load failures
  it('should skip images that fail to load', async () => {
    map.loadImage.mockImplementation(async (url: string) => {
      if (url.includes('p2')) throw new Error('Network error')
      return { data: { width: 64, height: 64, url } }
    })

    const features = makeFeatures(3)
    const loaded = await loader.updateViewport(features)

    expect(loaded.has('thumb-p1')).toBe(true)
    expect(loaded.has('thumb-p2')).toBe(false)
    expect(loaded.has('thumb-p3')).toBe(true)
    expect(loaded.size).toBe(2)
  })

  it('retries a transient thumbnail failure once before leaving the slot blank', async () => {
    let attempts = 0
    map.loadImage.mockImplementation(async (url: string) => {
      attempts += 1
      if (attempts <= 2) {
        throw new Error(`Transient error for ${url}`)
      }
      return { data: { width: 64, height: 64, url } }
    })

    const loaded = await loader.updateViewport([
      makeFeature('p1', 'https://image.anitabi.cn/points/1/p1.jpg?plan=h160'),
    ])

    expect(loaded.has('thumb-p1')).toBe(true)
    expect(map.loadImage).toHaveBeenCalledTimes(3)
  })

  it('does not perform an extra loader-level retry after a timeout-shaped failure', async () => {
    map.loadImage.mockImplementation(async (url: string) => {
      if (decodeURIComponent(url).includes('/api/anitabi/image-render?url=https://image.anitabi.cn/points/1/p1.jpg?plan=h160')
        && !decodeURIComponent(url).includes('_retry=1')) {
        return await new Promise(() => {})
      }
      if (decodeURIComponent(url).includes('_retry=1')) {
        return await new Promise(() => {})
      }
      return { data: { width: 64, height: 64, url } }
    })

    const timedLoader = new ThumbnailLoader({
      map: map as any,
      maxLoaded: 200,
      proxyRequestTimeoutMs: 5,
    })

    const loaded = await timedLoader.updateViewport([
      makeFeature('p1', 'https://image.anitabi.cn/points/1/p1.jpg?plan=h160'),
    ])

    expect(loaded.has('thumb-p1')).toBe(false)
    expect(map.loadImage).toHaveBeenCalledTimes(2)
  })

  // 9. Concurrent load limiting (max 10 parallel)
  it('should limit concurrent loads to 10', async () => {
    let concurrentCount = 0
    let maxConcurrent = 0

    map.loadImage.mockImplementation(async () => {
      concurrentCount++
      maxConcurrent = Math.max(maxConcurrent, concurrentCount)
      await new Promise((r) => setTimeout(r, 10))
      concurrentCount--
      return { data: { width: 64, height: 64, url: '' } }
    })

    const features = makeFeatures(30)
    await loader.updateViewport(features)

    expect(maxConcurrent).toBeLessThanOrEqual(10)
    expect(maxConcurrent).toBeGreaterThan(1) // Should be parallelized
  })

  // 10. Returns accurate Set of loaded IDs
  it('should return Set containing exactly the currently loaded image IDs', async () => {
    const features = makeFeatures(5)
    const loaded = await loader.updateViewport(features)

    const expectedIds = new Set(['thumb-p1', 'thumb-p2', 'thumb-p3', 'thumb-p4', 'thumb-p5'])
    expect(loaded).toEqual(expectedIds)
  })

  // 11. Empty viewport clears nothing (loaded images persist until evicted)
  it('should retain loaded images when viewport becomes empty', async () => {
    await loader.updateViewport(makeFeatures(3))
    expect(map.images.size).toBe(3)

    const loaded = await loader.updateViewport([])
    // Images stay loaded (no eviction needed, under cap)
    expect(loaded.size).toBe(3)
  })

  // 12. Duplicate features in single call
  it('should handle duplicate pointIds in a single call', async () => {
    const features = [makeFeature('p1'), makeFeature('p1'), makeFeature('p1')]
    const loaded = await loader.updateViewport(features)

    expect(loaded.size).toBe(1)
    expect(map.loadImage).toHaveBeenCalledTimes(1)
  })

  // 13. Image ID convention
  it('should use thumb-{pointId} as image ID convention', async () => {
    const features = [makeFeature('abc-123')]
    await loader.updateViewport(features)

    expect(map.images.has('thumb-abc-123')).toBe(true)
  })

  it('bounds local waiting and advances to the next candidate when a direct request stalls', async () => {
    map.loadImage.mockImplementation(async (url: string) => {
      if (decodeURIComponent(url).includes('/api/anitabi/image-render?url=https://image.anitabi.cn/points/1/p1.jpg?plan=h160')
        && !decodeURIComponent(url).includes('_retry=1')) {
        return await new Promise(() => {})
      }
      return { data: { width: 64, height: 64, url } }
    })

    const timedLoader = new ThumbnailLoader({
      map: map as any,
      maxLoaded: 200,
      directRequestTimeoutMs: 5,
      proxyRequestTimeoutMs: 5,
    })

    const loaded = await timedLoader.updateViewport([
      makeFeature('p1', 'https://image.anitabi.cn/points/1/p1.jpg?plan=h160'),
    ])

    expect(loaded.has('thumb-p1')).toBe(true)
    expect(map.loadImage).toHaveBeenCalledTimes(2)
    expect(decodeURIComponent(String(map.loadImage.mock.calls[1]?.[0] || ''))).toContain(
      '/api/anitabi/image-render?url=https://image.anitabi.cn/points/1/p1.jpg?plan=h160&_retry=1',
    )
  })

  it('aborts stale viewport work so a newer update can acquire the shared lane', async () => {
    map.loadImage.mockImplementation(async (url: string) => {
      if (url.includes('/points/1/p1.jpg')) {
        return await new Promise(() => {})
      }
      return { data: { width: 64, height: 64, url } }
    })

    const first = loader.updateViewport([
      makeFeature('p1', 'https://image.anitabi.cn/points/1/p1.jpg?plan=h160'),
    ])
    await Promise.resolve()

    const second = loader.updateViewport([
      makeFeature('p2', 'https://image.anitabi.cn/points/2/p2.jpg?plan=h160'),
    ])

    const loaded = await second
    await first

    expect(loaded.has('thumb-p2')).toBe(true)
    expect(loaded.has('thumb-p1')).toBe(false)
    expect(
      map.loadImage.mock.calls.some((call) =>
        decodeURIComponent(String(call[0] || '')).includes(
          '/api/anitabi/image-render?url=https://image.anitabi.cn/points/2/p2.jpg?plan=h160',
        )),
    ).toBe(true)
  })

  // 14. normalizePointThumbnailUrl is used for URL normalization
  it('should normalize URLs via normalizePointThumbnailUrl', async () => {
    const features = [makeFeature('p1', 'https://anitabi.cn/img/test.jpg?plan=123')]
    await loader.updateViewport(features)

    const callUrl = decodeURIComponent(String(map.loadImage.mock.calls[0][0] || ''))
    expect(callUrl).toContain('/api/anitabi/image-render?url=https://image.anitabi.cn/img/test.jpg?plan=123')
    expect(callUrl).not.toContain('w=')
    expect(callUrl).not.toContain('q=')
  })

  // 15. Multiple load failures don't affect successful loads
  it('should load all successful images even when some fail', async () => {
    map.loadImage.mockImplementation(async (url: string) => {
      const decoded = decodeURIComponent(url)
      if (
        decoded.includes('p2.jpg')
        || decoded.includes('p4.jpg')
        || decoded.includes('p6.jpg')
        || decoded.includes('p8.jpg')
        || decoded.includes('p10.jpg')
      ) {
        throw new Error('fail')
      }
      return { data: { width: 64, height: 64, url } }
    })

    const features = Array.from({ length: 10 }, (_, index) =>
      makeFeature(`p${index + 1}`, `https://example.com/img/p${index + 1}.jpg`)
    )
    const loaded = await loader.updateViewport(features)

    // Half should succeed (odd calls)
    expect(loaded.size).toBe(5)
  })

  it('tracks first-view request and settlement callbacks for the prioritized slice', async () => {
    const requestStart = vi.fn()
    const terminal = vi.fn()
    loader = new ThumbnailLoader({
      map: map as any,
      maxLoaded: 200,
      firstViewTrackedLimit: 2,
      onTrackedRequestStart: (input) => {
        requestStart(input)
        return { requestUrl: input.requestedCandidateUrl, requestId: `${input.slotKey}:${input.candidateIndex}` }
      },
      onTrackedRequestTerminal: terminal,
    })

    await loader.updateViewport(makeFeatures(4))

    expect(requestStart.mock.calls.map((call) => call[0].slotKey)).toEqual(['thumb-p1', 'thumb-p2'])
    expect(terminal.mock.calls.map((call) => [call[0].handle?.requestId, call[0].terminalState])).toEqual([
      ['thumb-p1:0', 'succeeded'],
      ['thumb-p2:0', 'succeeded'],
    ])
  })

  it('does not re-emit tracked thumbnail terminal events during retry cooldown', async () => {
    const terminal = vi.fn()
    map.loadImage.mockImplementation(async () => {
      throw new Error('Network error')
    })
    loader = new ThumbnailLoader({
      map: map as any,
      maxLoaded: 200,
      firstViewTrackedLimit: 1,
      onTrackedRequestStart: (input) => ({ requestUrl: input.requestedCandidateUrl, requestId: `${input.slotKey}:0` }),
      onTrackedRequestTerminal: terminal,
    })

    await loader.updateViewport([makeFeature('p1', 'https://example.com/img/p1.jpg')])
    const loadCallsAfterFirstAttempt = map.loadImage.mock.calls.length
    const terminalCallsAfterFirstAttempt = terminal.mock.calls.length
    await loader.updateViewport([makeFeature('p1', 'https://example.com/img/p1.jpg')])

    expect(loadCallsAfterFirstAttempt).toBe(4)
    expect(terminalCallsAfterFirstAttempt).toBe(4)
    expect(map.loadImage).toHaveBeenCalledTimes(loadCallsAfterFirstAttempt)
    expect(terminal).toHaveBeenCalledTimes(terminalCallsAfterFirstAttempt)
    const firstTerminalCall = terminal.mock.calls.at(0) as any[] | undefined
    expect(firstTerminalCall?.[0]).toMatchObject({
      terminalState: 'failed',
      outcome: 'network_error',
    })
  })
})
