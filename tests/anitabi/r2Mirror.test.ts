import { describe, expect, it } from 'vitest'
import { computeCanonicalImageUrl, computeMirrorKey } from '@/lib/anitabi/imageNormalize'
import { getMirroredImage, putMirroredImage } from '@/lib/anitabi/r2Mirror'

type StoredObject = {
  body: ArrayBuffer
  customMetadata: Record<string, string>
  httpMetadata?: { contentType?: string }
  size: number
}

function encodeBytes(input: string): ArrayBuffer {
  return new TextEncoder().encode(input).buffer
}

function cloneArrayBuffer(input: ArrayBuffer): ArrayBuffer {
  return input.slice(0)
}

function toArrayBuffer(input: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (input instanceof ArrayBuffer) {
    return cloneArrayBuffer(input)
  }

  const copy = new Uint8Array(input.byteLength)
  copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
  return copy.buffer
}

class FakeBucket {
  readonly objects = new Map<string, StoredObject>()
  readonly getFailures = new Set<string>()
  putCalls = 0

  async head(key: string) {
    const stored = this.objects.get(key)
    if (!stored) return null

    return {
      key,
      size: stored.size,
      customMetadata: { ...stored.customMetadata },
      httpMetadata: stored.httpMetadata ? { ...stored.httpMetadata } : undefined,
    }
  }

  async get(key: string) {
    if (this.getFailures.has(key)) {
      throw new Error('bucket_get_failed')
    }

    const stored = this.objects.get(key)
    if (!stored) return null

    return {
      key,
      size: stored.size,
      customMetadata: { ...stored.customMetadata },
      httpMetadata: stored.httpMetadata ? { ...stored.httpMetadata } : undefined,
      arrayBuffer: async () => cloneArrayBuffer(stored.body),
    }
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } },
  ) {
    this.putCalls += 1

    const body = toArrayBuffer(value)
    this.objects.set(key, {
      body,
      size: body.byteLength,
      customMetadata: { ...(options?.customMetadata || {}) },
      httpMetadata: options?.httpMetadata ? { ...options.httpMetadata } : undefined,
    })

    return {
      key,
      size: body.byteLength,
    }
  }
}

describe('r2 mirror client', () => {
  it('stores mirrored objects with canonical metadata and content type', async () => {
    const bucket = new FakeBucket()
    const rawUrl = 'https://anitabi.cn/images/bangumi/123/cover.jpg?plan=h320&__mi_request=req-1'
    const bytes = encodeBytes('hello')
    const canonicalUrl = computeCanonicalImageUrl(rawUrl)
    const key = await computeMirrorKey(canonicalUrl, 'image/jpeg')

    await expect(putMirroredImage(bucket, rawUrl, bytes, 'image/jpeg', 'lazy')).resolves.toEqual({
      key,
      bytesWritten: bytes.byteLength,
      skipped: false,
    })

    const stored = bucket.objects.get(key)
    expect(stored).toBeDefined()
    expect(stored?.httpMetadata).toEqual({ contentType: 'image/jpeg' })
    expect(stored?.customMetadata).toEqual(expect.objectContaining({
      originalUrl: canonicalUrl,
      mimeType: 'image/jpeg',
      mirrorSource: 'lazy',
      contentLength: String(bytes.byteLength),
    }))
    expect(Date.parse(String(stored?.customMetadata.mirroredAt))).not.toBeNaN()
  })

  it('skips overwriting fresh objects within seven days', async () => {
    const bucket = new FakeBucket()
    const rawUrl = 'https://anitabi.cn/images/bangumi/123/cover.jpg?plan=h320'
    const firstBytes = encodeBytes('first')
    const secondBytes = encodeBytes('second')
    const canonicalUrl = computeCanonicalImageUrl(rawUrl)
    const key = await computeMirrorKey(canonicalUrl, 'image/jpeg')

    await putMirroredImage(bucket, rawUrl, firstBytes, 'image/jpeg', 'lazy')
    const firstStored = bucket.objects.get(key)

    const result = await putMirroredImage(bucket, rawUrl, secondBytes, 'image/jpeg', 'cron-refresh')

    expect(result.key).toBe(key)
    expect(result.skipped).toBe(true)
    expect(bucket.putCalls).toBe(1)
    expect(bucket.objects.get(key)?.customMetadata.mirrorSource).toBe('lazy')
    expect(bucket.objects.get(key)?.customMetadata.mirroredAt).toBe(firstStored?.customMetadata.mirroredAt)
    expect(new Uint8Array(bucket.objects.get(key)?.body || new ArrayBuffer(0))).toEqual(new Uint8Array(firstBytes))
  })

  it('returns null when a mirrored image is missing', async () => {
    const bucket = new FakeBucket()

    await expect(
      getMirroredImage(bucket, 'https://anitabi.cn/images/bangumi/123/cover.jpg?plan=h320', 'image/jpeg'),
    ).resolves.toBeNull()
  })

  it('returns mirrored bytes, metadata, and content type on hit', async () => {
    const bucket = new FakeBucket()
    const rawUrl = 'https://bgm.tv/pic/cover/l/b8/0d/513345_jv4wM.jpg'
    const bytes = encodeBytes('payload')
    const canonicalUrl = computeCanonicalImageUrl(rawUrl)
    const key = await computeMirrorKey(canonicalUrl, 'image/webp')

    await bucket.put(key, bytes, {
      httpMetadata: { contentType: 'image/webp' },
      customMetadata: {
        originalUrl: canonicalUrl,
        mimeType: 'image/webp',
        mirroredAt: '2026-05-03T00:00:00.000Z',
        mirrorSource: 'cron-seed',
        contentLength: String(bytes.byteLength),
      },
    })

    const mirrored = await getMirroredImage(bucket, rawUrl, 'image/webp')

    expect(mirrored).toEqual(expect.objectContaining({
      key,
      customMetadata: {
        originalUrl: canonicalUrl,
        mimeType: 'image/webp',
        mirroredAt: '2026-05-03T00:00:00.000Z',
        mirrorSource: 'cron-seed',
        contentLength: String(bytes.byteLength),
      },
      httpContentType: 'image/webp',
      size: bytes.byteLength,
    }))
    expect(new Uint8Array(mirrored?.bytes || new ArrayBuffer(0))).toEqual(new Uint8Array(bytes))
  })

  it('returns null when bucket.get throws', async () => {
    const bucket = new FakeBucket()
    const rawUrl = 'https://anitabi.cn/images/bangumi/123/cover.jpg?plan=h320'
    const canonicalUrl = computeCanonicalImageUrl(rawUrl)
    const key = await computeMirrorKey(canonicalUrl, 'image/jpeg')

    await bucket.put(key, encodeBytes('payload'), {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {
        originalUrl: canonicalUrl,
        mimeType: 'image/jpeg',
        mirroredAt: '2026-05-03T00:00:00.000Z',
        mirrorSource: 'lazy',
        contentLength: '7',
      },
    })
    bucket.getFailures.add(key)

    await expect(getMirroredImage(bucket, rawUrl, 'image/jpeg')).resolves.toBeNull()
  })
})
