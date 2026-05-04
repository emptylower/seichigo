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
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

type StoredObject = {
  body: ArrayBuffer
  customMetadata: R2MirrorCustomMetadata
  httpMetadata?: { contentType?: string }
  size: number
}

function cloneArrayBuffer(input: ArrayBuffer): ArrayBuffer {
  return input.slice(0)
}

function toArrayBuffer(input: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (input instanceof ArrayBuffer) return cloneArrayBuffer(input)
  const copy = new Uint8Array(input.byteLength)
  copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
  return copy.buffer
}

class FakeBucket implements R2MirrorBucket {
  readonly objects = new Map<string, StoredObject>()
  readonly getCalls: string[] = []

  async head(key: string) {
    const stored = this.objects.get(key)
    if (!stored) return null

    return {
      size: stored.size,
      customMetadata: { ...stored.customMetadata },
      httpMetadata: stored.httpMetadata ? { ...stored.httpMetadata } : undefined,
    }
  }

  async get(key: string) {
    this.getCalls.push(key)
    const stored = this.objects.get(key)
    if (!stored) return null

    return {
      size: stored.size,
      customMetadata: { ...stored.customMetadata },
      httpMetadata: stored.httpMetadata ? { ...stored.httpMetadata } : undefined,
      arrayBuffer: async () => cloneArrayBuffer(stored.body),
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
    const body = toArrayBuffer(value)
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
      httpMetadata: options?.httpMetadata ? { ...options.httpMetadata } : undefined,
    })
    return { key, size: body.byteLength }
  }
}

class ThrowingGetBucket extends FakeBucket {
  override async get(key: string): Promise<Awaited<ReturnType<FakeBucket['get']>>> {
    this.getCalls.push(key)
    throw new Error(`R2 read failed for ${key}`)
  }
}

class MissThenHitBucket extends FakeBucket {
  constructor(private readonly missesBeforeHit: number) {
    super()
  }

  override async get(key: string): Promise<Awaited<ReturnType<FakeBucket['get']>>> {
    this.getCalls.push(key)
    if (this.getCalls.length <= this.missesBeforeHit) return null

    const stored = this.objects.get(key)
    if (!stored) return null

    return {
      size: stored.size,
      customMetadata: { ...stored.customMetadata },
      httpMetadata: stored.httpMetadata ? { ...stored.httpMetadata } : undefined,
      arrayBuffer: async () => cloneArrayBuffer(stored.body),
    }
  }
}

function createDeps(overrides?: {
  env?: {
    MAP_IMAGE_CACHE?: R2MirrorBucket
    NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED?: string
    NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED?: string
  }
  ctx?: {
    waitUntil?: (promise: Promise<unknown>) => void
  }
}): AnitabiApiDeps {
  return {
    prisma: {} as never,
    getSession: async () => null,
    now: () => new Date(),
    getCronSecret: () => '',
    getApiBase: () => 'https://api.anitabi.cn',
    getSiteBase: () => 'https://www.anitabi.cn',
    ...overrides,
  } as AnitabiApiDeps
}

function createRenderRequest(url: string) {
  const requestUrl = new URL('http://localhost/api/anitabi/image-render')
  requestUrl.searchParams.set('url', url)
  return new Request(requestUrl)
}

function createImageResponse() {
  return new Response(PNG_BYTES, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-length': String(PNG_BYTES.byteLength),
    },
  })
}

function getDiagEvents() {
  return mocks.emitMapImageProxyEvent.mock.calls.map((call) => call[2])
}

async function seedMirroredObject(bucket: FakeBucket, input?: {
  rawUrl?: string
  bytes?: Uint8Array
  mimeType?: string
  mirroredAt?: string
  originalUrl?: string
  httpContentType?: string
}) {
  const rawUrl = input?.rawUrl ?? 'https://bgm.tv/subject/1/cover.png'
  const bytes = input?.bytes ?? PNG_BYTES
  const mimeType = input?.mimeType ?? 'image/jpeg'
  const canonicalUrl = computeCanonicalImageUrl(rawUrl)
  const key = await computeMirrorKey(canonicalUrl, mimeType)

  await bucket.put(key, bytes, {
    customMetadata: {
      originalUrl: input?.originalUrl ?? canonicalUrl,
      mimeType,
      mirroredAt: input?.mirroredAt ?? '2026-05-03T00:00:00.000Z',
      mirrorSource: 'cron-seed',
      contentLength: String(bytes.byteLength),
    },
    httpMetadata: input?.httpContentType ? { contentType: input.httpContentType } : undefined,
  })

  return { key, canonicalUrl, rawUrl, bytes }
}

describe('serveImageRequest R2 primary read', () => {
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

  it('serves a seeded R2 object before upstream fetch when the read flag is enabled', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket, {
      httpContentType: 'image/webp',
    })

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        },
      }),
      'render',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/webp')
    expect(response.headers.get('Cache-Control')).toBe('public, s-maxage=86400, stale-while-revalidate=604800')
    expect(response.headers.get('Content-Disposition')).toBe('inline')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Seichigo-Image-Source')).toBe('r2-primary')
    expect(response.headers.get('X-Seichigo-Image-Mirrored-At')).toBe('2026-05-03T00:00:00.000Z')
    expect(response.headers.get('X-Original-Source')).toBe(seeded.canonicalUrl)
    expect(response.headers.get('Content-Length')).toBe(String(seeded.bytes.byteLength))
    expect(response.headers.get('X-Seichigo-Render-Cache')).toBe('MISS')
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.cachePut).toHaveBeenCalledTimes(1)
  })

  it('returns upstream render headers with the final redirected source when R2 is unavailable', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket)
    const redirectedUrl = 'https://api.anitabi.cn/points/1/image.png'
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: redirectedUrl },
      }))
      .mockResolvedValueOnce(createImageResponse())

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '0',
        },
      }),
      'render',
    )

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(bucket.getCalls).toEqual([])
    expect(response.headers.get('X-Original-Source')).toBe(redirectedUrl)
    expect(response.headers.get('X-Seichigo-Image-Source')).toBe('upstream-no-r2')
  })

  it('writes upstream render bytes to R2 via waitUntil when the write flag is enabled', async () => {
    const bucket = new FakeBucket()
    const rawUrl = 'https://bgm.tv/subject/1/cover.png?download=0'
    let writePromise: Promise<unknown> | undefined
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      writePromise = promise
    })
    vi.mocked(fetch).mockResolvedValueOnce(createImageResponse())

    const response = await serveImageRequest(
      createRenderRequest(rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '1',
        },
        ctx: { waitUntil },
      }),
      'render',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Original-Source')).toBe(computeCanonicalImageUrl(rawUrl))
    expect(response.headers.get('X-Seichigo-Image-Source')).toBe('upstream-with-r2-write')
    expect(response.headers.get('X-Seichigo-Render-Cache')).toBe('MISS')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(writePromise).toBeDefined()

    await writePromise

    const canonicalUrl = computeCanonicalImageUrl(rawUrl)
    const key = await computeMirrorKey(canonicalUrl, 'image/png')
    const stored = bucket.objects.get(key)

    expect(stored).toBeDefined()
    expect(stored?.size).toBe(PNG_BYTES.byteLength)
    expect(new Uint8Array(stored?.body || new ArrayBuffer(0))).toEqual(PNG_BYTES)
    expect(stored?.httpMetadata).toEqual({ contentType: 'image/png' })
    expect(stored?.customMetadata.originalUrl).toBe(canonicalUrl)
    expect(stored?.customMetadata.mimeType).toBe('image/png')
    expect(stored?.customMetadata.mirrorSource).toBe('lazy')
  })

  it('does not write upstream render bytes to R2 when the user stream errors mid-flight', async () => {
    const bucket = new FakeBucket()
    const rawUrl = 'https://bgm.tv/subject/1/abort.png'
    const waitUntil = vi.fn()

    const erroringBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.error(new Error('upstream connection lost'))
      },
    })
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(erroringBody, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': '100',
        },
      }),
    )

    const response = await serveImageRequest(
      createRenderRequest(rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '1',
        },
        ctx: { waitUntil },
      }),
      'render',
    )

    expect(response.status).toBe(200)
    await expect(response.arrayBuffer()).rejects.toThrow()
    expect(waitUntil).not.toHaveBeenCalled()
    expect(bucket.objects.size).toBe(0)
  })

  it('does not write upstream render bytes to R2 when the write flag is disabled', async () => {
    const bucket = new FakeBucket()
    const rawUrl = 'https://bgm.tv/subject/1/cover.png'
    const waitUntil = vi.fn()
    vi.mocked(fetch).mockResolvedValueOnce(createImageResponse())

    const response = await serveImageRequest(
      createRenderRequest(rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '0',
        },
        ctx: { waitUntil },
      }),
      'render',
    )

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
    expect(waitUntil).not.toHaveBeenCalled()
    expect(bucket.objects.size).toBe(0)
  })

  it('treats an oversized R2 object as a miss and falls through to upstream fetch', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket)
    const stored = bucket.objects.get(seeded.key)
    if (!stored) throw new Error('expected seeded R2 object')
    stored.size = MAX_IMAGE_BYTES + 1
    vi.mocked(fetch).mockResolvedValueOnce(createImageResponse())

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        },
      }),
      'render',
    )

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Original-Source')).toBe(computeCanonicalImageUrl(seeded.rawUrl))
    expect(response.headers.get('X-Seichigo-Image-Source')).toBe('upstream-no-r2')
    expect(response.headers.get('X-Seichigo-Render-Cache')).toBe('MISS')
    expect(mocks.cachePut).toHaveBeenCalledTimes(1)
  })

  it('falls back to R2 when upstream stream throws response_too_large mid-flight', async () => {
    const bucket = new MissThenHitBucket(6)
    const seeded = await seedMirroredObject(bucket, {
      httpContentType: 'image/webp',
      originalUrl: 'https://cdn.example.com/oversized-source.webp',
    })

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('upstream-too-large', {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(MAX_IMAGE_BYTES + 1),
        },
      }),
    )

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        },
      }),
      'render',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Seichigo-Image-Source')).toBe('r2-fallback')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(seeded.bytes)

    const diagEvents = getDiagEvents()
    const fallbackHit = diagEvents.find((event) => (
      event?.stage === 'image_cache_state'
      && event?.outcome === 'cache_hit_r2_fallback'
      && event?.evidence?.recoveredFrom === 'response_too_large'
    ))
    expect(fallbackHit).toBeDefined()
  })

  it('serves a seeded R2 object after an upstream timeout failure when the read flag is enabled', async () => {
    const bucket = new MissThenHitBucket(6)
    const seeded = await seedMirroredObject(bucket, {
      httpContentType: 'image/webp',
      originalUrl: 'https://cdn.example.com/mirrored-cover.webp',
    })
    vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        },
      }),
      'render',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/webp')
    expect(response.headers.get('Cache-Control')).toBe('public, s-maxage=86400, stale-while-revalidate=604800')
    expect(response.headers.get('Content-Disposition')).toBe('inline')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Seichigo-Image-Source')).toBe('r2-fallback')
    expect(response.headers.get('X-Seichigo-Image-Mirrored-At')).toBe('2026-05-03T00:00:00.000Z')
    expect(response.headers.get('X-Original-Source')).toBe('https://cdn.example.com/mirrored-cover.webp')
    expect(response.headers.get('Content-Length')).toBe(String(seeded.bytes.byteLength))
    expect(response.headers.get('X-Seichigo-Render-Cache')).toBe('MISS')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(seeded.bytes)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(mocks.cachePut).toHaveBeenCalledTimes(1)
    expect(bucket.getCalls.length).toBeGreaterThan(0)

    const diagEvents = getDiagEvents()
    const upstreamFailureIndex = diagEvents.findIndex((event) => (
      event?.stage === 'proxy_fetch_terminal'
      && event?.outcome === 'timeout'
      && !event?.terminalState
      && event?.evidence?.recoveredBy === 'r2-fallback'
    ))
    const fallbackHitIndex = diagEvents.findIndex((event) => (
      event?.stage === 'image_cache_state'
      && event?.outcome === 'cache_hit_r2_fallback'
      && event?.terminalState === 'succeeded'
    ))

    expect(upstreamFailureIndex).toBeGreaterThanOrEqual(0)
    expect(fallbackHitIndex).toBeGreaterThan(upstreamFailureIndex)
    expect(diagEvents.some((event) => event?.stage === 'proxy_fetch_terminal' && event?.terminalState === 'failed')).toBe(false)
  })

  it('returns the original upstream failure when R2 fallback misses after a 5xx-style fetch failure', async () => {
    const bucket = new FakeBucket()
    const rawUrl = 'https://bgm.tv/subject/1/cover.png'
    vi.mocked(fetch).mockResolvedValueOnce(new Response('upstream unavailable', { status: 503 }))

    const response = await serveImageRequest(
      createRenderRequest(rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        },
      }),
      'render',
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: '图片读取失败' })
    expect(bucket.getCalls.length).toBeGreaterThan(0)

    const diagEvents = getDiagEvents()
    expect(diagEvents.some((event) => (
      event?.stage === 'proxy_fetch_terminal'
      && event?.outcome === 'network_error'
      && event?.terminalState === 'failed'
    ))).toBe(true)
    expect(diagEvents.some((event) => event?.outcome === 'cache_full_miss_failed')).toBe(true)
  })

  it('returns the original upstream timeout when the read flag is disabled even if a mirrored object exists', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket)
    vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '0',
        },
      }),
      'render',
    )

    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toEqual({ error: '图片代理超时' })
    expect(bucket.getCalls).toEqual([])
    expect(response.headers.get('X-Seichigo-Image-Source')).toBeNull()
  })

  it('does not attempt R2 fallback after an upstream content validation failure', async () => {
    const bucket = new FakeBucket()
    const rawUrl = 'https://bgm.tv/subject/1/cover.png'
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not-image', {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'content-length': '9',
      },
    }))

    const response = await serveImageRequest(
      createRenderRequest(rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        },
      }),
      'render',
    )

    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toEqual({ error: '文件类型不支持' })
    expect(bucket.getCalls.length).toBeGreaterThan(0)
    expect(getDiagEvents().some((event) => event?.outcome === 'cache_hit_r2_fallback')).toBe(false)
    expect(getDiagEvents().some((event) => event?.outcome === 'cache_full_miss_failed')).toBe(false)
  })

  it('treats an oversized R2 fallback object as a miss and preserves the upstream timeout failure', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket)
    const stored = bucket.objects.get(seeded.key)
    if (!stored) throw new Error('expected seeded R2 object')
    stored.size = MAX_IMAGE_BYTES + 1
    vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))

    const response = await serveImageRequest(
      createRenderRequest(seeded.rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        },
      }),
      'render',
    )

    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toEqual({ error: '图片代理超时' })
    expect(bucket.getCalls.length).toBeGreaterThan(0)
    expect(bucket.getCalls).toContain(seeded.key)

    const diagEvents = getDiagEvents()
    expect(diagEvents.some((event) => (
      event?.stage === 'proxy_fetch_terminal'
      && event?.outcome === 'timeout'
      && event?.terminalState === 'failed'
    ))).toBe(true)
    expect(diagEvents.some((event) => event?.outcome === 'cache_full_miss_failed')).toBe(true)
  })

  it('falls through to upstream fetch when the mirrored R2 object is missing', async () => {
    const bucket = new FakeBucket()
    const rawUrl = 'https://bgm.tv/subject/1/cover.png'
    vi.mocked(fetch).mockResolvedValueOnce(createImageResponse())

    const response = await serveImageRequest(
      createRenderRequest(rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        },
      }),
      'render',
    )

    expect(response.status).toBe(200)
    expect(bucket.getCalls.length).toBeGreaterThan(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(response.headers.get('X-Original-Source')).toBe(rawUrl)
    expect(response.headers.get('X-Seichigo-Image-Source')).toBe('upstream-no-r2')
  })

  it('falls through to upstream fetch when reading the mirrored R2 object errors', async () => {
    const bucket = new ThrowingGetBucket()
    const rawUrl = 'https://bgm.tv/subject/1/cover.png'
    vi.mocked(fetch).mockResolvedValueOnce(createImageResponse())

    const response = await serveImageRequest(
      createRenderRequest(rawUrl),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        },
      }),
      'render',
    )

    expect(response.status).toBe(200)
    expect(bucket.getCalls.length).toBeGreaterThan(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(response.headers.get('X-Original-Source')).toBe(rawUrl)
    expect(response.headers.get('X-Seichigo-Image-Source')).toBe('upstream-no-r2')
  })

  it('does not touch R2 or upstream fetch for disallowed targets', async () => {
    const bucket = new FakeBucket()

    const response = await serveImageRequest(
      createRenderRequest('http://127.0.0.1/internal.png'),
      createDeps({
        env: {
          MAP_IMAGE_CACHE: bucket,
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        },
      }),
      'render',
    )

    expect(response.status).toBe(400)
    expect(bucket.getCalls).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})
