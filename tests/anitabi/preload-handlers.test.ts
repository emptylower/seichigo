import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { createHandlers as createManifestHandlers } from '@/lib/anitabi/handlers/preloadManifest'
import { createHandlers as createChunkHandlers } from '@/lib/anitabi/handlers/preloadChunks'

const mocks = vi.hoisted(() => ({
  getPreloadManifest: vi.fn(),
  listPreloadChunk: vi.fn(),
}))

vi.mock('@/lib/anitabi/read', () => ({
  getPreloadManifest: mocks.getPreloadManifest,
  listPreloadChunk: mocks.listPreloadChunk,
}))

function createDeps(): AnitabiApiDeps {
  return {
    prisma: {} as never,
    getSession: async () => null,
    now: () => new Date(),
    getCronSecret: () => '',
    getApiBase: () => 'https://api.anitabi.cn',
    getSiteBase: () => 'https://www.anitabi.cn',
  }
}

describe('anitabi preload handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('manifest handler returns preload manifest with cache headers', async () => {
    mocks.getPreloadManifest.mockResolvedValue({
      datasetVersion: 'v1',
      modifiedMs: 1,
      chunkSize: 200,
      chunkCount: 1,
      tabs: { nearby: [], latest: [], recent: [], hot: [] },
    })
    const deps = createDeps()
    const res = await createManifestHandlers(deps).GET(new Request('http://localhost/api/anitabi/preload/manifest?locale=zh'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.datasetVersion).toBe('v1')
    expect(mocks.getPreloadManifest).toHaveBeenCalledTimes(1)
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=300, stale-while-revalidate=1800')
  })

  it('chunk handler returns chunk payload with cache headers', async () => {
    mocks.listPreloadChunk.mockResolvedValue({
      datasetVersion: 'v2',
      index: 3,
      items: [{
        bangumiId: 99,
        modifiedMs: 10,
        points: [],
        theme: null,
      }],
    })
    const deps = createDeps()
    const res = await createChunkHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/preload/chunks/3?locale=ja'),
      { index: '3' },
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.index).toBe(3)
    expect(json.datasetVersion).toBe('v2')
    expect(mocks.listPreloadChunk).toHaveBeenCalledTimes(1)
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=300, stale-while-revalidate=1800')
  })
})
