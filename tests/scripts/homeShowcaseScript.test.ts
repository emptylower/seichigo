import { describe, expect, it, vi } from 'vitest'
import {
  ensureProxiedImage,
  ensureShowcaseImage,
  resolvePhotoReference,
  type PhotoReferenceClient,
} from '../../scripts/homeShowcaseScript'

function makeClient(overrides: Partial<PhotoReferenceClient> = {}): PhotoReferenceClient {
  return {
    findPointGooglePlaceId: vi.fn(async () => null),
    findExternalPlace: vi.fn(async () => null),
    ...overrides,
  }
}

describe('resolvePhotoReference（三层分支）', () => {
  it('returns the explicit ref param without touching any client', async () => {
    const client = makeClient()

    const ref = await resolvePhotoReference('/api/google/place-photo?ref=ref-direct&i=3', client)

    expect(ref).toBe('ref-direct')
    expect(client.findPointGooglePlaceId).not.toHaveBeenCalled()
    expect(client.findExternalPlace).not.toHaveBeenCalled()
  })

  it('resolves a placeId to the indexed photo reference from photos', async () => {
    const client = makeClient({
      findExternalPlace: vi.fn(async () => ({
        photos: [
          { photoReference: 'ref-0000', attribution: 'a0' },
          { photoReference: 'ref-1111', attribution: 'a1' },
        ],
        photoReference: 'ref-root0',
      })),
    })

    expect(
      await resolvePhotoReference('/api/google/place-photo?placeId=ChIJ1&i=1', client)
    ).toBe('ref-1111')
    expect(client.findExternalPlace).toHaveBeenCalledWith('ChIJ1')
  })

  it('falls back to the root photoReference only for index 0 when photos misses', async () => {
    const client = makeClient({
      findExternalPlace: vi.fn(async () => ({ photos: [], photoReference: 'ref-root0' })),
    })

    expect(
      await resolvePhotoReference('/api/google/place-photo?placeId=ChIJ1&i=0', client)
    ).toBe('ref-root0')
    // i>0 越界时不得回落到根引用（会展示错图）
    expect(
      await resolvePhotoReference('/api/google/place-photo?placeId=ChIJ1&i=1', client)
    ).toBeNull()
  })

  it('maps pointId to googlePlaceId before the place lookup and gives up without one', async () => {
    const findPoint = vi.fn(async (pointId: string) => {
      expect(pointId).toBe('point-9')
      return 'ChIJ-from-point'
    })
    const client = makeClient({
      findPointGooglePlaceId: findPoint,
      findExternalPlace: vi.fn(async () => ({ photos: [{ photoReference: 'ref-pppp', attribution: null }], photoReference: null })),
    })

    expect(
      await resolvePhotoReference('/api/google/point-photo?pointId=point-9', client)
    ).toBe('ref-pppp')

    const noPlace = makeClient({ findPointGooglePlaceId: async () => null })
    expect(
      await resolvePhotoReference('/api/google/point-photo?pointId=point-x', noPlace)
    ).toBeNull()
  })

  it('clamps the index into 0..9 and treats non-numeric values as 0', async () => {
    const photos = Array.from({ length: 3 }, (_, i) => ({ photoReference: `ref-000${i}`, attribution: null }))
    const client = makeClient({
      findExternalPlace: vi.fn(async () => ({ photos, photoReference: null })),
    })

    expect(await resolvePhotoReference('/api/google/place-photo?placeId=p&i=99', client)).toBeNull()
    expect(await resolvePhotoReference('/api/google/place-photo?placeId=p&i=-3', client)).toBe('ref-0000')
    expect(await resolvePhotoReference('/api/google/place-photo?placeId=p&i=abc', client)).toBe('ref-0000')
  })

  it('returns null when the external place row is missing entirely', async () => {
    const client = makeClient({ findExternalPlace: async () => null })

    expect(await resolvePhotoReference('/api/google/place-photo?placeId=gone', client)).toBeNull()
  })
})

describe('ensureShowcaseImage（下载幂等分支）', () => {
  function makeDeps(overrides: Record<string, unknown> = {}) {
    return {
      displayUrl: '/api/google/place-photo?placeId=abc&maxwidth=320',
      imagePath: '/tmp/showcase/abc.jpg',
      fileExists: vi.fn(async () => false),
      writeFile: vi.fn(async () => {}),
      resolveReference: vi.fn(async () => 'ref-1111'),
      fetchPhoto: vi.fn(async () => new Uint8Array([1, 2, 3])),
      ...overrides,
    }
  }

  it('reuses an existing file without resolving, fetching or writing', async () => {
    const deps = makeDeps({ fileExists: vi.fn(async () => true) })

    await expect(ensureShowcaseImage(deps)).resolves.toBe('reused')

    expect(deps.fileExists).toHaveBeenCalledWith('/tmp/showcase/abc.jpg')
    expect(deps.resolveReference).not.toHaveBeenCalled()
    expect(deps.fetchPhoto).not.toHaveBeenCalled()
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it('downloads, writes and reports downloaded for a missing file', async () => {
    const deps = makeDeps()

    await expect(ensureShowcaseImage(deps)).resolves.toBe('downloaded')

    expect(deps.resolveReference).toHaveBeenCalledTimes(1)
    expect(deps.fetchPhoto).toHaveBeenCalledWith('ref-1111')
    expect(deps.writeFile).toHaveBeenCalledWith('/tmp/showcase/abc.jpg', new Uint8Array([1, 2, 3]))
  })

  it('throws without writing when no photo reference can be resolved', async () => {
    const deps = makeDeps({ resolveReference: vi.fn(async () => null) })

    await expect(ensureShowcaseImage(deps)).rejects.toThrow(/no photo reference/)
    expect(deps.fetchPhoto).not.toHaveBeenCalled()
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it('propagates fetch failures without leaving a partial file behind', async () => {
    const deps = makeDeps({ fetchPhoto: vi.fn(async () => { throw new Error('fetch failed (500)') }) })

    await expect(ensureShowcaseImage(deps)).rejects.toThrow('fetch failed (500)')
    expect(deps.writeFile).not.toHaveBeenCalled()
  })
})

describe('ensureProxiedImage（公开代理下载幂等分支，A1）', () => {
  function makeProxyDeps(overrides: Record<string, unknown> = {}) {
    return {
      url: 'https://seichigo.com/api/anitabi/image-render?url=https%253A%252F%252Fimage.anitabi.cn',
      imagePath: '/tmp/showcase/proxy.jpg',
      fileExists: vi.fn(async () => false),
      writeFile: vi.fn(async () => {}),
      fetchImage: vi.fn(async () => new Uint8Array([1, 2, 3])),
      ...overrides,
    }
  }

  it('reuses an existing file without fetching or writing', async () => {
    const deps = makeProxyDeps({ fileExists: vi.fn(async () => true) })

    await expect(ensureProxiedImage(deps)).resolves.toBe('reused')

    expect(deps.fetchImage).not.toHaveBeenCalled()
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it('downloads, writes and reports downloaded for a missing file', async () => {
    const deps = makeProxyDeps()

    await expect(ensureProxiedImage(deps)).resolves.toBe('downloaded')

    expect(deps.fetchImage).toHaveBeenCalledWith(deps.url)
    expect(deps.writeFile).toHaveBeenCalledWith('/tmp/showcase/proxy.jpg', new Uint8Array([1, 2, 3]))
  })

  it('throws on an empty body without writing', async () => {
    const deps = makeProxyDeps({ fetchImage: vi.fn(async () => new Uint8Array(0)) })

    await expect(ensureProxiedImage(deps)).rejects.toThrow(/empty image body/)
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it('propagates fetch failures without writing', async () => {
    const deps = makeProxyDeps({ fetchImage: vi.fn(async () => { throw new Error('proxy fetch failed (502)') }) })

    await expect(ensureProxiedImage(deps)).rejects.toThrow('proxy fetch failed (502)')
    expect(deps.writeFile).not.toHaveBeenCalled()
  })
})
