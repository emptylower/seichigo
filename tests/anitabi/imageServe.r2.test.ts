import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { computeCanonicalImageUrl, computeMirrorKey } from '@/lib/anitabi/imageNormalize'
import type { R2MirrorBucket, R2MirrorCustomMetadata } from '@/lib/anitabi/r2Mirror'
import { serveImageRequest } from '@/lib/anitabi/handlers/imageServe'

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  cacheMatch: vi.fn(),
  cachePut: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  lookup: mocks.lookup,
}))

const SAFE_LOOKUP_RESULT = [{ address: '93.184.216.34', family: 4 as const }]
const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

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

function createDeps(overrides?: {
  env?: {
    MAP_IMAGE_CACHE?: R2MirrorBucket
    NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED?: string
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

  it('falls through to upstream fetch when the read flag is disabled', async () => {
    const bucket = new FakeBucket()
    const seeded = await seedMirroredObject(bucket)
    vi.mocked(fetch).mockResolvedValueOnce(createImageResponse())

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
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(bucket.getCalls).toEqual([])
    expect(response.headers.get('X-Seichigo-Image-Source')).toBeNull()
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
