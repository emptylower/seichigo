import { describe, expect, it } from 'vitest'
import { InMemoryCacheStore } from '@/lib/anitabi/client/clientCache'

describe('cache store v2 preload', () => {
  it('stores preload manifest/chunk and clears on version switch', async () => {
    const store = new InMemoryCacheStore()

    await store.putPreloadManifest({
      datasetVersion: 'v1',
      manifest: {
        datasetVersion: 'v1',
        modifiedMs: 1,
        chunkSize: 200,
        chunkCount: 1,
        tabs: { nearby: [], latest: [], recent: [], hot: [] },
      },
      cachedAt: Date.now(),
    })
    await store.putPreloadChunk(0, {
      datasetVersion: 'v1',
      index: 0,
      chunk: {
        datasetVersion: 'v1',
        index: 0,
        items: [],
      },
      cachedAt: Date.now(),
    })
    expect((await store.getPreloadManifest())?.datasetVersion).toBe('v1')
    expect((await store.getPreloadChunk(0))?.datasetVersion).toBe('v1')

    await store.putCards('latest', {
      datasetVersion: 'v2',
      tab: 'latest',
      cards: [],
      cachedAt: Date.now(),
    })

    expect(await store.getPreloadManifest()).toBeNull()
    expect(await store.getPreloadChunk(0)).toBeNull()
    expect(await store.getVersion()).toBe('v2')
  })
})
