import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { computeCanonicalImageUrl, computeMirrorKey } from '@/lib/anitabi/imageNormalize'
import type { R2MirrorBucket, R2MirrorCustomMetadata } from '@/lib/anitabi/r2Mirror'
import { serveImageRequest } from '@/lib/anitabi/handlers/imageServe'

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  cacheMatch: vi.fn(),
  cachePut: vi.fn(),
  dispatchMapImageProxyEvent: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  lookup: mocks.lookup,
}))

vi.mock('@/lib/mapImageDiag/proxy', () => ({
  dispatchMapImageProxyEvent: (...args: any[]) => mocks.dispatchMapImageProxyEvent(...args),
}))

const SAFE_LOOKUP_RESULT = [{ address: '93.184.216.34', family: 4 as const }]
const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

type StoredObject = {
  body: ArrayBuffer
  customMetadata: R2MirrorCustomMetadata
  httpMetadata?: { contentType?: string }
  size: number
}

function cloneArrayBuffer(input: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input.slice(0)

  const copy = new Uint8Array(input.byteLength)
  copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
  return copy.buffer
}

class FakeBucket implements R2MirrorBucket {
  readonly objects = new Map<string, StoredObject>()

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
    const stored = this.objects.get(key)
    if (!stored) return null

    return {
      size: stored.size,
      customMetadata: { ...stored.customMetadata },
      httpMetadata: stored.httpMetadata ? { ...stored.httpMetadata } : undefined,
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
    const bytes = cloneArrayBuffer(value)

    this.objects.set(key, {
      body: bytes,
      size: bytes.byteLength,
      customMetadata: options?.customMetadata || {
        originalUrl: '',
        mimeType: 'image/jpeg',
        mirroredAt: '',
        mirrorSource: '',
        contentLength: String(bytes.byteLength),
      },
      httpMetadata: options?.httpMetadata ? { ...options.httpMetadata } : undefined,
    })

    return { key, size: bytes.byteLength }
  }
}

class MissThenHitBucket extends FakeBucket {
  constructor(private missesBeforeHit: number) {
    super()
  }

  override async get(key: string): Promise<Awaited<ReturnType<FakeBucket['get']>>> {
    if (this.missesBeforeHit > 0) {
      this.missesBeforeHit -= 1
      return null
    }
    return super.get(key)
  }
}

function createDeps(overrides?: {
  env?: {
    MAP_IMAGE_CACHE?: R2MirrorBucket
    NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED?: string
    NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED?: string
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

function createRenderRequest(rawUrl: string) {
  const requestUrl = new URL('http://localhost/api/anitabi/image-render')
  requestUrl.searchParams.set('url', rawUrl)
  return new Request(requestUrl)
}

function createImageResponse(input?: { contentType?: string; contentLength?: number }) {
  return new Response(PNG_BYTES, {
    status: 200,
    headers: {
      'content-type': input?.contentType ?? 'image/png',
      'content-length': String(input?.contentLength ?? PNG_BYTES.byteLength),
    },
  })
}

function createCachedRenderResponse() {
  return new Response(PNG_BYTES, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-length': String(PNG_BYTES.byteLength),
      'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
    },
  })
}

function getDiagEvents() {
  return mocks.dispatchMapImageProxyEvent.mock.calls.map((call) => call[2])
}

function getImageCacheEvents() {
  return getDiagEvents().filter((event) => event?.stage === 'image_cache_state')
}

async function seedMirroredObject(bucket: FakeBucket, rawUrl = 'https://bgm.tv/subject/1/cover.png') {
  const canonicalUrl = computeCanonicalImageUrl(rawUrl)
  const key = await computeMirrorKey(canonicalUrl, 'image/png')

  await bucket.put(key, PNG_BYTES, {
    customMetadata: {
      originalUrl: canonicalUrl,
      mimeType: 'image/png',
      mirroredAt: '2026-05-03T00:00:00.000Z',
      mirrorSource: 'cron-seed',
      contentLength: String(PNG_BYTES.byteLength),
    },
    httpMetadata: { contentType: 'image/png' },
  })

  return { canonicalUrl, key, rawUrl }
}

describe('serveImageRequest image cache diagnostics', () => {
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

  it('emits cache_miss_all exactly once when upstream render succeeds with R2 disabled', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(createImageResponse())

    const response = await serveImageRequest(
      createRenderRequest('https://bgm.tv/subject/1/cover.png'),
      createDeps({
        env: {
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '0',
        },
      }),
      'render',
    )

    expect(response.status).toBe(200)
    expect(getImageCacheEvents()).toEqual([
      expect.objectContaining({
        outcome: 'cache_miss_all',
        terminalState: 'succeeded',
      }),
    ])
  })

  it('emits cache_hit_cf exactly once on a worker cache hit and skips upstream fetch', async () => {
    mocks.cacheMatch.mockResolvedValueOnce(createCachedRenderResponse())

    const response = await serveImageRequest(
      createRenderRequest('https://bgm.tv/subject/1/cover.png'),
      createDeps(),
      'render',
    )

    expect(response.status).toBe(200)
    expect(fetch).not.toHaveBeenCalled()
    expect(getImageCacheEvents()).toEqual([
      expect.objectContaining({
        outcome: 'cache_hit_cf',
        terminalState: 'succeeded',
      }),
    ])
  })

  it('emits cache_hit_r2_primary exactly once on an R2 primary hit', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket)

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
    expect(getImageCacheEvents()).toEqual([
      expect.objectContaining({
        outcome: 'cache_hit_r2_primary',
        terminalState: 'succeeded',
      }),
    ])
  })

  it('emits cache_hit_r2_fallback exactly once on a fallback recovery and does not emit a failed terminal fetch event', async () => {
    const bucket = new MissThenHitBucket(6)
    const seeded = await seedMirroredObject(bucket)
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
    expect(getImageCacheEvents()).toEqual([
      expect.objectContaining({
        outcome: 'cache_hit_r2_fallback',
        terminalState: 'succeeded',
      }),
    ])
    expect(getDiagEvents().some((event) => (
      event?.stage === 'proxy_fetch_terminal'
      && event?.terminalState === 'failed'
    ))).toBe(false)
  })

  it('emits cache_full_miss_failed exactly once when upstream fails and R2 is disabled', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))

    const response = await serveImageRequest(
      createRenderRequest('https://bgm.tv/subject/1/cover.png'),
      createDeps({
        env: {
          NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '0',
        },
      }),
      'render',
    )

    expect(response.status).toBe(504)
    expect(getImageCacheEvents()).toEqual([
      expect.objectContaining({
        outcome: 'cache_full_miss_failed',
        terminalState: 'failed',
      }),
    ])
  })
})
