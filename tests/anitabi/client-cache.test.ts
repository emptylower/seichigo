import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createCacheStore, InMemoryCacheStore } from '@/lib/anitabi/client/clientCache'
import type {
  CachedBangumiDetail,
  CachedCardsPayload,
  CachedPreloadChunk,
  CachedPreloadManifest,
} from '@/lib/anitabi/client/types'
import type { AnitabiMapTab, AnitabiBangumiCard, AnitabiBangumiDTO } from '@/lib/anitabi/types'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeCard(id: number): AnitabiBangumiCard {
  return {
    id,
    title: `Bangumi ${id}`,
    titleZh: `番组 ${id}`,
    cat: 'TV',
    city: 'Tokyo',
    cover: null,
    color: null,
    pointsLength: 3,
    imagesLength: 2,
    sourceModifiedMs: Date.now(),
    mapEnabled: true,
    geo: [35.68, 139.76],
    zoom: 12,
    nearestDistanceMeters: null,
  }
}

function makeCardsPayload(
  tab: AnitabiMapTab,
  version: string,
  cards: AnitabiBangumiCard[] = [makeCard(1)],
): CachedCardsPayload {
  return { datasetVersion: version, tab, cards, cachedAt: Date.now() }
}

function makeDetail(bangumiId: number, version: string): CachedBangumiDetail {
  const detail: AnitabiBangumiDTO = {
    card: makeCard(bangumiId),
    description: 'test desc',
    tags: ['tag1'],
    points: [],
    customEpNames: {},
    theme: null,
    contributors: [],
  }
  return { datasetVersion: version, bangumiId, detail, cachedAt: Date.now() }
}

function makePreloadManifest(version: string): CachedPreloadManifest {
  return {
    datasetVersion: version,
    manifest: {
      datasetVersion: version,
      modifiedMs: Date.now(),
      chunkSize: 200,
      chunkCount: 1,
      tabs: {
        nearby: [makeCard(1)],
        latest: [makeCard(1)],
        recent: [makeCard(1)],
        hot: [makeCard(1)],
      },
    },
    cachedAt: Date.now(),
  }
}

function makePreloadChunk(index: number, version: string): CachedPreloadChunk {
  return {
    datasetVersion: version,
    index,
    chunk: {
      datasetVersion: version,
      index,
      items: [{
        bangumiId: 1,
        modifiedMs: Date.now(),
        points: [{
          id: 'p1',
          name: 'Point 1',
          nameZh: null,
          geo: [35.68, 139.76],
          ep: '1',
          s: null,
          image: null,
          density: null,
          note: null,
        }],
        theme: null,
      }],
    },
    cachedAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// IndexedDB-backed tests (fake-indexeddb provides global indexedDB)
// ---------------------------------------------------------------------------

describe('clientCache (IndexedDB)', () => {
  beforeEach(async () => {
    const store = await createCacheStore()
    await store.clear()
  })

  it('createCacheStore() returns a working store', async () => {
    const store = await createCacheStore()
    expect(store).toBeDefined()
    expect(typeof store.getCards).toBe('function')
    expect(typeof store.putCards).toBe('function')
    expect(typeof store.getDetail).toBe('function')
    expect(typeof store.putDetail).toBe('function')
    expect(typeof store.getPreloadManifest).toBe('function')
    expect(typeof store.putPreloadManifest).toBe('function')
    expect(typeof store.getPreloadChunk).toBe('function')
    expect(typeof store.putPreloadChunk).toBe('function')
    expect(typeof store.getVersion).toBe('function')
    expect(typeof store.clear).toBe('function')
  })

  it('putCards / getCards roundtrip', async () => {
    const store = await createCacheStore()
    const payload = makeCardsPayload('latest', 'v1', [makeCard(10), makeCard(20)])

    await store.putCards('latest', payload)
    const result = await store.getCards('latest')

    expect(result).not.toBeNull()
    expect(result!.datasetVersion).toBe('v1')
    expect(result!.tab).toBe('latest')
    expect(result!.cards).toHaveLength(2)
    expect(result!.cards[0].id).toBe(10)
  })

  it('putDetail / getDetail roundtrip', async () => {
    const store = await createCacheStore()
    const detail = makeDetail(42, 'v1')

    await store.putDetail(42, detail)
    const result = await store.getDetail(42)

    expect(result).not.toBeNull()
    expect(result!.bangumiId).toBe(42)
    expect(result!.detail.description).toBe('test desc')
  })

  it('version change invalidates all details', async () => {
    const store = await createCacheStore()

    // Store cards + detail with version v1
    await store.putCards('latest', makeCardsPayload('latest', 'v1'))
    await store.putDetail(1, makeDetail(1, 'v1'))
    expect(await store.getDetail(1)).not.toBeNull()

    // Update cards with new version → should clear details store
    await store.putCards('latest', makeCardsPayload('latest', 'v2'))
    const detailAfter = await store.getDetail(1)
    expect(detailAfter).toBeNull()
  })

  it('clear() removes all data', async () => {
    const store = await createCacheStore()

    await store.putCards('latest', makeCardsPayload('latest', 'v1'))
    await store.putCards('hot', makeCardsPayload('hot', 'v1'))
    await store.putDetail(1, makeDetail(1, 'v1'))
    await store.putPreloadManifest(makePreloadManifest('v1'))
    await store.putPreloadChunk(0, makePreloadChunk(0, 'v1'))

    await store.clear()

    expect(await store.getCards('latest')).toBeNull()
    expect(await store.getCards('hot')).toBeNull()
    expect(await store.getDetail(1)).toBeNull()
    expect(await store.getPreloadManifest()).toBeNull()
    expect(await store.getPreloadChunk(0)).toBeNull()
    expect(await store.getVersion()).toBeNull()
  })

  it('put/get preload manifest and chunk roundtrip', async () => {
    const store = await createCacheStore()
    await store.putPreloadManifest(makePreloadManifest('v2'))
    await store.putPreloadChunk(3, makePreloadChunk(3, 'v2'))

    const manifest = await store.getPreloadManifest()
    const chunk = await store.getPreloadChunk(3)
    expect(manifest?.datasetVersion).toBe('v2')
    expect(manifest?.manifest.chunkCount).toBe(1)
    expect(chunk?.chunk.index).toBe(3)
    expect(chunk?.chunk.items[0]?.points.length).toBe(1)
  })

  it('version change invalidates preload stores', async () => {
    const store = await createCacheStore()
    await store.putPreloadManifest(makePreloadManifest('v1'))
    await store.putPreloadChunk(0, makePreloadChunk(0, 'v1'))
    await store.putCards('latest', makeCardsPayload('latest', 'v2'))

    expect(await store.getPreloadManifest()).toBeNull()
    expect(await store.getPreloadChunk(0)).toBeNull()
  })

  it('getVersion() returns latest stored version', async () => {
    const store = await createCacheStore()

    expect(await store.getVersion()).toBeNull()

    await store.putCards('latest', makeCardsPayload('latest', 'v1'))
    expect(await store.getVersion()).toBe('v1')

    await store.putCards('hot', makeCardsPayload('hot', 'v2'))
    expect(await store.getVersion()).toBe('v2')
  })

  it('getCards returns null for missing tab', async () => {
    const store = await createCacheStore()
    expect(await store.getCards('nearby')).toBeNull()
  })

  it('getDetail returns null for missing bangumiId', async () => {
    const store = await createCacheStore()
    expect(await store.getDetail(999)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// In-memory fallback tests (directly test InMemoryCacheStore)
// ---------------------------------------------------------------------------

describe('clientCache (in-memory fallback)', () => {
  it('falls back to in-memory when IndexedDB is unavailable', async () => {
    const saved = globalThis.indexedDB
    try {
      vi.stubGlobal('indexedDB', undefined)
      const store = await createCacheStore()

      // Should still work via in-memory path
      const payload = makeCardsPayload('latest', 'v1')
      await store.putCards('latest', payload)
      const result = await store.getCards('latest')

      expect(result).not.toBeNull()
      expect(result!.datasetVersion).toBe('v1')
    } finally {
      vi.stubGlobal('indexedDB', saved)
    }
  })

  it('in-memory: version change invalidates details', async () => {
    const store = new InMemoryCacheStore()

    await store.putCards('latest', makeCardsPayload('latest', 'v1'))
    await store.putDetail(1, makeDetail(1, 'v1'))
    await store.putPreloadManifest(makePreloadManifest('v1'))
    await store.putPreloadChunk(0, makePreloadChunk(0, 'v1'))
    expect(await store.getDetail(1)).not.toBeNull()

    await store.putCards('latest', makeCardsPayload('latest', 'v2'))
    expect(await store.getDetail(1)).toBeNull()
    expect(await store.getPreloadManifest()).toBeNull()
    expect(await store.getPreloadChunk(0)).toBeNull()
  })

  it('in-memory: clear removes all data', async () => {
    const store = new InMemoryCacheStore()

    await store.putCards('latest', makeCardsPayload('latest', 'v1'))
    await store.putDetail(1, makeDetail(1, 'v1'))

    await store.clear()

    expect(await store.getCards('latest')).toBeNull()
    expect(await store.getDetail(1)).toBeNull()
    expect(await store.getVersion()).toBeNull()
  })

  it('in-memory: getVersion tracks version from putDetail', async () => {
    const store = new InMemoryCacheStore()

    expect(await store.getVersion()).toBeNull()

    // putDetail sets version when no version exists yet
    await store.putDetail(1, makeDetail(1, 'v1'))
    expect(await store.getVersion()).toBe('v1')
  })
})
