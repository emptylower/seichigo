import { afterEach, describe, expect, it, vi } from 'vitest'
import { processSeedBatch, type ProcessSeedBatchPrisma } from '@/lib/anitabi/mirror/seed'
import type { R2MirrorBucket, R2MirrorCustomMetadata } from '@/lib/anitabi/r2Mirror'

const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

type StoredObject = {
  bytes: ArrayBuffer
  customMetadata: R2MirrorCustomMetadata
  httpMetadata?: { contentType?: string }
}

function cloneBytes(input: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input.slice(0)

  const copy = new Uint8Array(input.byteLength)
  copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
  return copy.buffer
}

class RecordingBucket implements R2MirrorBucket {
  readonly objects = new Map<string, StoredObject>()

  async head() {
    return null
  }

  async get() {
    return null
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: {
      customMetadata?: R2MirrorCustomMetadata
      httpMetadata?: { contentType?: string }
    },
  ) {
    const bytes = cloneBytes(value)
    this.objects.set(key, {
      bytes,
      customMetadata: options?.customMetadata || {
        originalUrl: '',
        mimeType: '',
        mirroredAt: '',
        mirrorSource: '',
        contentLength: String(bytes.byteLength),
      },
      httpMetadata: options?.httpMetadata ? { ...options.httpMetadata } : undefined,
    })
    return { key }
  }
}

function buildSeedPrisma(rows: Array<{ id: string; canonicalUrl: string; attempts: number | null }>) {
  const findMany = vi.fn<ProcessSeedBatchPrisma['mapImageMirrorState']['findMany']>().mockResolvedValue(rows)
  const findFirst = vi.fn<ProcessSeedBatchPrisma['mapImageMirrorState']['findFirst']>().mockResolvedValue({ id: 'owned' })
  const updateMany = vi.fn<ProcessSeedBatchPrisma['mapImageMirrorState']['updateMany']>().mockResolvedValue({ count: 1 })

  const prisma: ProcessSeedBatchPrisma = {
    mapImageMirrorState: { findMany, findFirst, updateMany },
  }

  return { prisma, updateMany }
}

describe('processSeedBatch delivery host', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the delivery host (img-tc) while mirroring under the canonical host key', async () => {
    const canonicalUrl = 'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80'
    const { prisma } = buildSeedPrisma([{ id: 'seed-1', canonicalUrl, attempts: 0 }])
    const bucket = new RecordingBucket()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(PNG_BYTES, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await processSeedBatch(prisma, bucket, { batchSize: 1, perRequestDelayMs: 0 })

    expect(result).toEqual({ mirrored: 1, failed: 0, skipped404: 0, retried: 0, timedOut: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://img-tc.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80',
    )

    expect(bucket.objects.size).toBe(1)
    const stored = [...bucket.objects.values()][0]
    // canonical key 走 computeCanonicalImageUrl（host 归一 + 参数排序），零漂移
    expect(stored?.customMetadata.originalUrl).toBe(
      'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?q=80&w=640',
    )
  })

  it('keeps non-anitabi canonical URLs untouched when fetching', async () => {
    const canonicalUrl = 'https://lain.bgm.tv/pic/cover/m/b8/0d/513345_jv4wM.jpg'
    const { prisma } = buildSeedPrisma([{ id: 'seed-2', canonicalUrl, attempts: 0 }])
    const bucket = new RecordingBucket()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(PNG_BYTES, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await processSeedBatch(prisma, bucket, { batchSize: 1, perRequestDelayMs: 0 })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(canonicalUrl)
    const stored = [...bucket.objects.values()][0]
    expect(stored?.customMetadata.originalUrl).toBe(canonicalUrl)
  })
})
