import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { createHandlers as createSpriteManifestHandlers } from '@/lib/anitabi/handlers/spriteManifest'
import { createHandlers as createSpriteSheetHandlers } from '@/lib/anitabi/handlers/spriteSheet'

function createDeps(overrides: Partial<AnitabiApiDeps> = {}): AnitabiApiDeps {
  return {
    prisma: {} as never,
    getSession: async () => null,
    now: () => new Date(),
    getCronSecret: () => '',
    getApiBase: () => 'https://api.anitabi.cn',
    getSiteBase: () => 'https://www.anitabi.cn',
    ...overrides,
  }
}

const ATLAS_BYTES = new TextEncoder().encode(
  JSON.stringify({ version: 'a1b2c3d4e5f6', tile: 72, grid: [2, 1], count: 1, icons: { '101': [0, 0] } }),
)

const SHEET_BYTES = new Uint8Array([1, 2, 3, 4]).buffer

describe('anitabi sprite handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('manifest serves the atlas from R2 with cache headers', async () => {
    const deps = createDeps({
      env: {
        MAP_IMAGE_CACHE: {
          get: vi.fn(async () => ({
            arrayBuffer: async () => ATLAS_BYTES.slice(0),
            httpMetadata: { contentType: 'application/json' },
          })),
        } as never,
      },
    })

    const res = await createSpriteManifestHandlers(deps).GET()

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=300, stale-while-revalidate=1800')
    await expect(res.json()).resolves.toMatchObject({ version: 'a1b2c3d4e5f6' })
  })

  it('manifest returns 404 (fallback contract) when sprite is not generated yet', async () => {
    const deps = createDeps({
      env: { MAP_IMAGE_CACHE: { get: vi.fn(async () => null) } as never },
    })

    const res = await createSpriteManifestHandlers(deps).GET()

    expect(res.status).toBe(404)
  })

  it('manifest returns 404 without the R2 binding configured', async () => {
    const res = await createSpriteManifestHandlers(createDeps()).GET()

    expect(res.status).toBe(404)
  })

  it('sheet serves immutable webp bytes keyed by version', async () => {
    const get = vi.fn(async () => ({
      arrayBuffer: async () => SHEET_BYTES.slice(0),
      httpMetadata: { contentType: 'image/webp' },
    }))
    const deps = createDeps({ env: { MAP_IMAGE_CACHE: { get } as never } })

    const res = await createSpriteSheetHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/sprite/sheet?v=a1b2c3d4e5f6'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(get).toHaveBeenCalledWith('sprites/v2/sheet-a1b2c3d4e5f6.webp')
  })

  it('sheet rejects malformed version params', async () => {
    const deps = createDeps({
      env: { MAP_IMAGE_CACHE: { get: vi.fn(async () => null) } as never },
    })

    const res = await createSpriteSheetHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/sprite/sheet?v=../../evil'),
    )

    expect(res.status).toBe(400)
  })

  it('sheet returns 404 for unknown versions', async () => {
    const deps = createDeps({
      env: { MAP_IMAGE_CACHE: { get: vi.fn(async () => null) } as never },
    })

    const res = await createSpriteSheetHandlers(deps).GET(
      new Request('http://localhost/api/anitabi/sprite/sheet?v=000000000000'),
    )

    expect(res.status).toBe(404)
  })
})
