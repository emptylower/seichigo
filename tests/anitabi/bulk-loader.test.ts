import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAllCards } from '@/lib/anitabi/client/bulkLoader'
import { createProgressTracker } from '@/lib/anitabi/client/progressTracker'
import type { CacheStore, CachedCardsPayload, BulkCardsResponse } from '@/lib/anitabi/client/types'
import type { AnitabiBangumiCard } from '@/lib/anitabi/types'

// ---------------------------------------------------------------------------
// Mock CacheStore
// ---------------------------------------------------------------------------

function createMockCacheStore(): CacheStore {
  const cardsCache = new Map<string, CachedCardsPayload>()
  let version: string | null = null

  return {
    async getCards(tab) {
      return cardsCache.get(tab) ?? null
    },
    async putCards(tab, payload) {
      cardsCache.set(tab, payload)
    },
    async getDetail() {
      return null
    },
    async putDetail() {},
    async getVersion() {
      return version
    },
    async clear() {
      cardsCache.clear()
      version = null
    },
    // Test helper
    _setVersion(v: string | null) {
      version = v
    }
  } as CacheStore & { _setVersion(v: string | null): void }
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

function mockFetchSuccess(data: BulkCardsResponse, contentLength?: number) {
  const json = JSON.stringify(data)
  const encoder = new TextEncoder()
  const bytes = encoder.encode(json)

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })

  const headers = new Headers()
  if (contentLength !== undefined) {
    headers.set('content-length', String(contentLength))
  }

  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers,
    body: stream,
    json: async () => data
  })
}

function mockFetchError(status = 500) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    headers: new Headers(),
    body: null
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bulkLoader', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null for nearby tab', async () => {
    const cacheStore = createMockCacheStore()
    const progressTracker = createProgressTracker()

    const result = await loadAllCards({
      locale: 'zh',
      tab: 'nearby',
      cacheStore,
      progressTracker
    })

    expect(result).toBeNull()
  })

  it('fetches from API and stores in cache when cache is empty', async () => {
    const mockCards: AnitabiBangumiCard[] = [
      { id: 1, title: 'Test Anime', titleZh: null, cat: null, city: null, cover: '/test.jpg', color: null, pointsLength: 0, imagesLength: 0, sourceModifiedMs: null, mapEnabled: true, geo: [35.6, 139.7], zoom: null, nearestDistanceMeters: null }
    ]
    const mockResponse: BulkCardsResponse = {
      datasetVersion: 'v1',
      items: mockCards,
      total: 1
    }

    const fetchMock = mockFetchSuccess(mockResponse, JSON.stringify(mockResponse).length)
    vi.stubGlobal('fetch', fetchMock)

    const cacheStore = createMockCacheStore()
    const progressTracker = createProgressTracker()

    const result = await loadAllCards({
      locale: 'zh',
      tab: 'latest',
      cacheStore,
      progressTracker
    })

    expect(result).toEqual({
      cards: mockCards,
      datasetVersion: 'v1',
      fromCache: false
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/anitabi/bulk-cards?locale=zh&tab=latest',
      expect.objectContaining({ method: 'GET' })
    )

    // Verify cache was updated
    const cached = await cacheStore.getCards('latest')
    expect(cached).toEqual({
      datasetVersion: 'v1',
      tab: 'latest',
      cards: mockCards,
      cachedAt: expect.any(Number)
    })
  })

  it('returns cached data immediately when cache is fresh', async () => {
    const mockCards: AnitabiBangumiCard[] = [
      { id: 1, title: 'Cached Anime', titleZh: null, cat: null, city: null, cover: '/cached.jpg', color: null, pointsLength: 0, imagesLength: 0, sourceModifiedMs: null, mapEnabled: true, geo: [35.6, 139.7], zoom: null, nearestDistanceMeters: null }
    ]

    const cacheStore = createMockCacheStore() as CacheStore & { _setVersion(v: string | null): void }
    cacheStore._setVersion('v1')
    await cacheStore.putCards('latest', {
      datasetVersion: 'v1',
      tab: 'latest',
      cards: mockCards,
      cachedAt: Date.now()
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const progressTracker = createProgressTracker()

    const result = await loadAllCards({
      locale: 'zh',
      tab: 'latest',
      cacheStore,
      progressTracker
    })

    expect(result).toEqual({
      cards: mockCards,
      datasetVersion: 'v1',
      fromCache: true
    })

    // Background refresh is fire-and-forget (may be called asynchronously)
    // We just verify the cached result is returned immediately

    // Progress should be done
    expect(progressTracker.getProgress().phase).toBe('done')
  })

  it('progress callbacks fire during load', async () => {
    const mockResponse: BulkCardsResponse = {
      datasetVersion: 'v1',
      items: [],
      total: 0
    }

    const fetchMock = mockFetchSuccess(mockResponse, 1000)
    vi.stubGlobal('fetch', fetchMock)

    const cacheStore = createMockCacheStore()
    const progressTracker = createProgressTracker()
    const progressCallback = vi.fn()

    progressTracker.onProgress(progressCallback)

    await loadAllCards({
      locale: 'zh',
      tab: 'latest',
      cacheStore,
      progressTracker
    })

    // Should have been called at least for: reset, setPhase(loading), update(0, total), update(loaded, total), setPhase(done)
    expect(progressCallback).toHaveBeenCalled()
    expect(progressCallback.mock.calls.length).toBeGreaterThan(0)

    // Check final state
    const finalProgress = progressTracker.getProgress()
    expect(finalProgress.phase).toBe('done')
    expect(finalProgress.percent).toBe(100)
  })

  it('returns cached data when fetch fails and cache exists', async () => {
    const mockCards: AnitabiBangumiCard[] = [
      { id: 1, title: 'Stale Anime', titleZh: null, cat: null, city: null, cover: '/stale.jpg', color: null, pointsLength: 0, imagesLength: 0, sourceModifiedMs: null, mapEnabled: true, geo: [35.6, 139.7], zoom: null, nearestDistanceMeters: null }
    ]

    const cacheStore = createMockCacheStore()
    await cacheStore.putCards('latest', {
      datasetVersion: 'v0',
      tab: 'latest',
      cards: mockCards,
      cachedAt: Date.now() - 86400000 // 1 day old
    })

    const fetchMock = mockFetchError(500)
    vi.stubGlobal('fetch', fetchMock)

    const progressTracker = createProgressTracker()

    const result = await loadAllCards({
      locale: 'zh',
      tab: 'latest',
      cacheStore,
      progressTracker
    })

    expect(result).toEqual({
      cards: mockCards,
      datasetVersion: 'v0',
      fromCache: true
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(progressTracker.getProgress().phase).toBe('done')
  })

  it('throws error when fetch fails and no cache exists', async () => {
    const fetchMock = mockFetchError(500)
    vi.stubGlobal('fetch', fetchMock)

    const cacheStore = createMockCacheStore()
    const progressTracker = createProgressTracker()

    await expect(
      loadAllCards({
        locale: 'zh',
        tab: 'latest',
        cacheStore,
        progressTracker
      })
    ).rejects.toThrow('Bulk cards fetch failed: 500')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(progressTracker.getProgress().phase).toBe('idle')
  })

  it('AbortSignal cancels in-flight fetch', async () => {
    const controller = new AbortController()

    const fetchMock = vi.fn().mockImplementation(async (url, options) => {
      // Simulate abort during fetch
      if (options?.signal) {
        return new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
          setTimeout(() => controller.abort(), 10)
        })
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const cacheStore = createMockCacheStore()
    const progressTracker = createProgressTracker()

    await expect(
      loadAllCards({
        locale: 'zh',
        tab: 'latest',
        cacheStore,
        progressTracker,
        signal: controller.signal
      })
    ).rejects.toThrow('Aborted')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('handles fetch without ReadableStream body', async () => {
    const mockCards: AnitabiBangumiCard[] = [
      { id: 1, title: 'No Stream', titleZh: null, cat: null, city: null, cover: '/no-stream.jpg', color: null, pointsLength: 0, imagesLength: 0, sourceModifiedMs: null, mapEnabled: true, geo: [35.6, 139.7], zoom: null, nearestDistanceMeters: null }
    ]
    const mockResponse: BulkCardsResponse = {
      datasetVersion: 'v1',
      items: mockCards,
      total: 1
    }

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null, // No body
      json: async () => mockResponse
    })
    vi.stubGlobal('fetch', fetchMock)

    const cacheStore = createMockCacheStore()
    const progressTracker = createProgressTracker()

    const result = await loadAllCards({
      locale: 'zh',
      tab: 'latest',
      cacheStore,
      progressTracker
    })

    expect(result).toEqual({
      cards: mockCards,
      datasetVersion: 'v1',
      fromCache: false
    })
  })

  it('handles fetch without content-length header', async () => {
    const mockCards: AnitabiBangumiCard[] = [
      { id: 1, title: 'No Length', titleZh: null, cat: null, city: null, cover: '/no-length.jpg', color: null, pointsLength: 0, imagesLength: 0, sourceModifiedMs: null, mapEnabled: true, geo: [35.6, 139.7], zoom: null, nearestDistanceMeters: null }
    ]
    const mockResponse: BulkCardsResponse = {
      datasetVersion: 'v1',
      items: mockCards,
      total: 1
    }

    const fetchMock = mockFetchSuccess(mockResponse) // No contentLength
    vi.stubGlobal('fetch', fetchMock)

    const cacheStore = createMockCacheStore()
    const progressTracker = createProgressTracker()
    const progressCallback = vi.fn()
    progressTracker.onProgress(progressCallback)

    const result = await loadAllCards({
      locale: 'zh',
      tab: 'latest',
      cacheStore,
      progressTracker
    })

    expect(result).toEqual({
      cards: mockCards,
      datasetVersion: 'v1',
      fromCache: false
    })

    // Progress should have been updated with null total
    const progressCalls = progressCallback.mock.calls
    const updateCalls = progressCalls.filter(call => call[0].total === null)
    expect(updateCalls.length).toBeGreaterThan(0)
  })

  it('resets progress tracker before starting', async () => {
    const mockResponse: BulkCardsResponse = {
      datasetVersion: 'v1',
      items: [],
      total: 0
    }

    const fetchMock = mockFetchSuccess(mockResponse)
    vi.stubGlobal('fetch', fetchMock)

    const cacheStore = createMockCacheStore()
    const progressTracker = createProgressTracker()

    // Set some initial state
    progressTracker.update(50, 100)
    progressTracker.setPhase('loading')

    await loadAllCards({
      locale: 'zh',
      tab: 'latest',
      cacheStore,
      progressTracker
    })

    // Should have been reset during load
    const finalProgress = progressTracker.getProgress()
    expect(finalProgress.phase).toBe('done')
  })

  it('encodes locale and tab in URL', async () => {
    const mockResponse: BulkCardsResponse = {
      datasetVersion: 'v1',
      items: [],
      total: 0
    }

    const fetchMock = mockFetchSuccess(mockResponse)
    vi.stubGlobal('fetch', fetchMock)

    const cacheStore = createMockCacheStore()
    const progressTracker = createProgressTracker()

    await loadAllCards({
      locale: 'zh-CN',
      tab: 'hot',
      cacheStore,
      progressTracker
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/anitabi/bulk-cards?locale=zh-CN&tab=hot',
      expect.objectContaining({ method: 'GET' })
    )
  })
})
