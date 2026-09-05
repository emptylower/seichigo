import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { computeCanonicalImageUrl, computeMirrorKey } from '@/lib/anitabi/imageNormalize'
import type { R2MirrorBucket, R2MirrorCustomMetadata } from '@/lib/anitabi/r2Mirror'
import { serveImageRequest } from '@/lib/anitabi/handlers/imageServe'

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  cacheMatch: vi.fn(),
  cachePut: vi.fn(),
  emitMapImageProxyEvent: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  lookup: mocks.lookup,
}))

vi.mock('@/lib/mapImageDiag/proxy', () => ({
  dispatchMapImageProxyEvent: (...args: any[]) => mocks.emitMapImageProxyEvent(...args),
}))

const SAFE_LOOKUP_RESULT = [{ address: '93.184.216.34', family: 4 as const }]
const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

type StoredObject = {
  body: ArrayBuffer
  customMetadata: R2MirrorCustomMetadata
  httpEtag?: string
  size: number
}

class FakeBucket implements R2MirrorBucket {
  readonly objects = new Map<string, StoredObject>()

  async head(key: string) {
    const stored = this.objects.get(key)
    if (!stored) return null
    return {
      size: stored.size,
      customMetadata: { ...stored.customMetadata },
      httpEtag: stored.httpEtag,
    }
  }

  async get(key: string) {
    const stored = this.objects.get(key)
    if (!stored) return null
    return {
      size: stored.size,
      customMetadata: { ...stored.customMetadata },
      httpEtag: stored.httpEtag,
      arrayBuffer: async () => stored.body.slice(0),
    }
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: {
      customMetadata?: R2MirrorCustomMetadata
      httpMetadata?: { contentType?: string }
    },
  ) {
    const body = value instanceof ArrayBuffer
      ? value.slice(0)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer
    this.objects.set(key, {
      body,
      size: body.byteLength,
      customMetadata: options?.customMetadata || {
        originalUrl: '',
        mimeType: 'image/jpeg',
        mirroredAt: '',
        mirrorSource: '',
        contentLength: String(body.byteLength),
      },
    })
    return { key, size: body.byteLength }
  }
}

function createDeps(env: {
  MAP_IMAGE_CACHE?: R2MirrorBucket
  NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED?: string
}): AnitabiApiDeps {
  return {
    prisma: {} as never,
    getSession: async () => null,
    now: () => new Date(),
    getCronSecret: () => '',
    getApiBase: () => 'https://api.anitabi.cn',
    getSiteBase: () => 'https://www.anitabi.cn',
    env,
  } as AnitabiApiDeps
}

function createRenderRequest(url: string, options?: { ifNoneMatch?: string }) {
  const requestUrl = new URL('http://localhost/api/anitabi/image-render')
  requestUrl.searchParams.set('url', url)
  const headers = new Headers()
  if (options?.ifNoneMatch != null) headers.set('if-none-match', options.ifNoneMatch)
  return new Request(requestUrl, { headers })
}

async function seedMirroredObject(bucket: FakeBucket, httpEtag?: string) {
  const rawUrl = 'https://bgm.tv/subject/1/cover.png'
  const canonicalUrl = computeCanonicalImageUrl(rawUrl)
  const key = await computeMirrorKey(canonicalUrl, 'image/jpeg')

  await bucket.put(key, PNG_BYTES, {
    customMetadata: {
      originalUrl: canonicalUrl,
      mimeType: 'image/jpeg',
      mirroredAt: '2026-05-03T00:00:00.000Z',
      mirrorSource: 'cron-seed',
      contentLength: String(PNG_BYTES.byteLength),
    },
  })

  if (httpEtag) {
    const stored = bucket.objects.get(key)
    if (stored) stored.httpEtag = httpEtag
  }

  return { rawUrl, canonicalUrl, key }
}

function createReadEnabledDeps(bucket: FakeBucket): AnitabiApiDeps {
  return createDeps({
    MAP_IMAGE_CACHE: bucket,
    NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
  })
}

describe('serveImageRequest render ETag revalidation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.lookup.mockResolvedValue(SAFE_LOOKUP_RESULT)
    mocks.cacheMatch.mockResolvedValue(undefined)
    mocks.cachePut.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('caches', {
      default: {
        match: (...args: unknown[]) => mocks.cacheMatch(...args),
        put: (...args: unknown[]) => mocks.cachePut(...args),
      },
    })
  })

  it('exposes the R2 object etag on a primary hit without If-None-Match', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket, '"etag-cover-v1"')

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl),
      createReadEnabledDeps(bucket),
      'render',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toBe('"etag-cover-v1"')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.cachePut).toHaveBeenCalledTimes(1)
  })

  it('returns a bodyless 304 when If-None-Match matches the R2 object etag', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket, '"etag-cover-v1"')

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl, { ifNoneMatch: '"etag-cover-v1"' }),
      createReadEnabledDeps(bucket),
      'render',
    )

    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
    expect(response.headers.get('ETag')).toBe('"etag-cover-v1"')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800')
    expect(response.headers.get('Content-Length')).toBeNull()
    expect(response.headers.get('X-Seichigo-Render-Cache')).toBe('BYPASS')
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.cachePut).not.toHaveBeenCalled()
  })

  it('returns a bodyless 304 for a weak If-None-Match validator', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket, '"etag-cover-v1"')

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl, { ifNoneMatch: 'W/"etag-cover-v1"' }),
      createReadEnabledDeps(bucket),
      'render',
    )

    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
    expect(response.headers.get('ETag')).toBe('"etag-cover-v1"')
  })

  it('serves the full R2 object when If-None-Match does not match', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket, '"etag-cover-v1"')

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl, { ifNoneMatch: '"etag-other-v2"' }),
      createReadEnabledDeps(bucket),
      'render',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toBe('"etag-cover-v1"')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('omits ETag on R2 hits when the object has no httpEtag', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket)

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl, { ifNoneMatch: '"etag-cover-v1"' }),
      createReadEnabledDeps(bucket),
      'render',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toBeNull()
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
  })

  it('does not add ETag on upstream-fetched render responses', async () => {
    const bucket = new FakeBucket()
    const rawUrl = 'https://bgm.tv/subject/1/upstream-only.png'
    vi.mocked(fetch).mockResolvedValueOnce(new Response(PNG_BYTES, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': String(PNG_BYTES.byteLength),
        etag: '"upstream-etag"',
      },
    }))

    const response = await serveImageRequest(
      createRenderRequest(rawUrl),
      createReadEnabledDeps(bucket),
      'render',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800')
  })

  it('returns a bodyless 304 on a CF render cache hit when If-None-Match matches the cached etag', async () => {
    const bucket = new FakeBucket()
    mocks.cacheMatch.mockResolvedValueOnce(new Response(PNG_BYTES, {
      status: 200,
      headers: {
        ETag: '"cf-etag-v1"',
        'Content-Type': 'image/png',
      },
    }))

    const response = await serveImageRequest(
      createRenderRequest('https://bgm.tv/subject/1/cf-cached.png', { ifNoneMatch: '"cf-etag-v1"' }),
      createReadEnabledDeps(bucket),
      'render',
    )

    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
    expect(response.headers.get('ETag')).toBe('"cf-etag-v1"')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800')
    expect(response.headers.get('X-Seichigo-Render-Cache')).toBe('HIT')
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.cachePut).not.toHaveBeenCalled()
  })

  it('returns the cached CF body when If-None-Match does not match a CF render cache hit', async () => {
    const bucket = new FakeBucket()
    mocks.cacheMatch.mockResolvedValueOnce(new Response(PNG_BYTES, {
      status: 200,
      headers: {
        ETag: '"cf-etag-v1"',
        'Content-Type': 'image/png',
      },
    }))

    const response = await serveImageRequest(
      createRenderRequest('https://bgm.tv/subject/1/cf-cached.png', { ifNoneMatch: '"different-etag"' }),
      createReadEnabledDeps(bucket),
      'render',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Seichigo-Render-Cache')).toBe('HIT')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
    expect(fetch).not.toHaveBeenCalled()
  })
})
