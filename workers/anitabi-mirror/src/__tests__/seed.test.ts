import { afterEach, describe, expect, it, vi } from 'vitest'

import { computeCanonicalImageUrl, computeMirrorKey } from '@/lib/anitabi/imageNormalize'
import type { R2MirrorCustomMetadata } from '@/lib/anitabi/r2Mirror'

import { processSeedBatch, type ProcessSeedBatchPrisma } from '../seed'

type StoredObject = {
  body: ArrayBuffer
  customMetadata: R2MirrorCustomMetadata
  httpMetadata?: { contentType?: string }
  size: number
}

function toArrayBuffer(input: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (input instanceof ArrayBuffer) {
    return input.slice(0)
  }

  const copy = new Uint8Array(input.byteLength)
  copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
  return copy.buffer
}

class FakeBucket {
  readonly objects = new Map<string, StoredObject>()
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
    const stored = this.objects.get(key)
    if (!stored) return null

    return {
      key,
      size: stored.size,
      customMetadata: { ...stored.customMetadata },
      httpMetadata: stored.httpMetadata ? { ...stored.httpMetadata } : undefined,
      arrayBuffer: async () => stored.body.slice(0),
    }
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { customMetadata?: R2MirrorCustomMetadata; httpMetadata?: { contentType?: string } },
  ) {
    this.putCalls += 1
    if (!options?.customMetadata) {
      throw new Error('expected_custom_metadata')
    }

    const body = toArrayBuffer(value)

    this.objects.set(key, {
      body,
      size: body.byteLength,
      customMetadata: { ...options.customMetadata },
      httpMetadata: options.httpMetadata ? { ...options.httpMetadata } : undefined,
    })

    return {
      key,
      size: body.byteLength,
    }
  }
}

function encodeBytes(input: string): ArrayBuffer {
  return new TextEncoder().encode(input).buffer
}

function buildPrismaMock(
  items: Array<{
    id: string
    canonicalUrl: string
    attempts: number | null
    createdAt: Date
  }>,
) {
  const findMany = vi
    .fn<ProcessSeedBatchPrisma['mapImageMirrorState']['findMany']>()
    .mockResolvedValue(items)
  const update = vi
    .fn<ProcessSeedBatchPrisma['mapImageMirrorState']['update']>()
    .mockResolvedValue(null)

  const prisma = {
    mapImageMirrorState: {
      findMany,
      update,
    },
  } satisfies ProcessSeedBatchPrisma

  return { prisma, findMany, update }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('processSeedBatch', () => {
  it('rejects invalid batch sizes before querying Prisma', async () => {
    const { prisma, findMany } = buildPrismaMock([])

    await expect(processSeedBatch(prisma, new FakeBucket(), { batchSize: 0 })).rejects.toThrow(
      'batchSize must be a finite positive number',
    )
    expect(findMany).not.toHaveBeenCalled()
  })

  it('queries pending rows oldest-first and marks rows in progress before fetching', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const { prisma, findMany, update } = buildPrismaMock([
      {
        id: 'seed-1',
        canonicalUrl: 'https://image.anitabi.cn/point/1.jpg',
        attempts: 2,
        createdAt: new Date('2026-05-03T11:00:00Z'),
      },
    ])
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(processSeedBatch(prisma, new FakeBucket(), { batchSize: 3 })).resolves.toEqual({
      mirrored: 0,
      failed: 0,
      skipped404: 1,
    })

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 3,
    })
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: 'seed-1' },
      data: {
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T12:00:00Z'),
        attempts: { increment: 1 },
      },
    })
    expect(fetchMock).toHaveBeenCalledWith('https://image.anitabi.cn/point/1.jpg', {
      headers: { 'user-agent': 'SeichiGoMirror/1.0 (+https://seichigo.com)' },
      signal: expect.any(AbortSignal),
    })
  })

  it('writes fetched images to R2 and marks the row mirrored', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:30:00Z'))

    const bucket = new FakeBucket()
    const bytes = encodeBytes('seed-image')
    const item = {
      id: 'seed-2',
      canonicalUrl: 'https://anitabi.cn/images/bangumi/123/cover.jpg?plan=h320&cache=1',
      attempts: 0,
      createdAt: new Date('2026-05-03T12:00:00Z'),
    }
    const { prisma, update } = buildPrismaMock([item])
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg; charset=binary' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      processSeedBatch(prisma, bucket, {
        batchSize: 1,
        userAgent: 'MirrorBot/2.0',
      }),
    ).resolves.toEqual({
      mirrored: 1,
      failed: 0,
      skipped404: 0,
    })

    const canonicalUrl = computeCanonicalImageUrl(item.canonicalUrl)
    const key = await computeMirrorKey(canonicalUrl, 'image/jpeg; charset=binary')
    const stored = bucket.objects.get(key)

    expect(stored).toBeDefined()
    expect(stored?.httpMetadata).toEqual({ contentType: 'image/jpeg; charset=binary' })
    expect(stored?.customMetadata).toEqual(expect.objectContaining({
      originalUrl: canonicalUrl,
      mimeType: 'image/jpeg; charset=binary',
      mirrorSource: 'cron-seed',
      contentLength: String(bytes.byteLength),
      mirroredAt: '2026-05-03T12:30:00.000Z',
    }))
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 'seed-2' },
      data: {
        status: 'mirrored',
        mirroredAt: new Date('2026-05-03T12:30:00Z'),
        contentBytes: bytes.byteLength,
        lastError: null,
      },
    })
    expect(fetchMock).toHaveBeenCalledWith(item.canonicalUrl, {
      headers: { 'user-agent': 'MirrorBot/2.0' },
      signal: expect.any(AbortSignal),
    })
  })

  it('marks 404 responses as skipped without counting a failure', async () => {
    const { prisma, update } = buildPrismaMock([
      {
        id: 'seed-3',
        canonicalUrl: 'https://image.anitabi.cn/missing.jpg',
        attempts: 1,
        createdAt: new Date('2026-05-03T12:00:00Z'),
      },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
    )

    await expect(processSeedBatch(prisma, new FakeBucket(), { batchSize: 1 })).resolves.toEqual({
      mirrored: 0,
      failed: 0,
      skipped404: 1,
    })

    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 'seed-3' },
      data: { status: 'skipped_404' },
    })
  })

  it('returns retryable errors to pending when the attempt ceiling has not been reached', async () => {
    const { prisma, update } = buildPrismaMock([
      {
        id: 'seed-4',
        canonicalUrl: 'https://image.anitabi.cn/error.jpg',
        attempts: 3,
        createdAt: new Date('2026-05-03T12:00:00Z'),
      },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('bad gateway', { status: 502 })),
    )

    await expect(processSeedBatch(prisma, new FakeBucket(), { batchSize: 1 })).resolves.toEqual({
      mirrored: 0,
      failed: 0,
      skipped404: 0,
    })

    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 'seed-4' },
      data: {
        status: 'pending',
        lastError: 'Error: upstream 502',
      },
    })
  })

  it('marks max-attempt and non-image responses as failed', async () => {
    const { prisma, update } = buildPrismaMock([
      {
        id: 'seed-5',
        canonicalUrl: 'https://image.anitabi.cn/maxed.jpg',
        attempts: 4,
        createdAt: new Date('2026-05-03T12:00:00Z'),
      },
      {
        id: 'seed-6',
        canonicalUrl: 'https://image.anitabi.cn/not-image',
        attempts: 4,
        createdAt: new Date('2026-05-03T12:05:00Z'),
      },
    ])
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('timeout', { status: 503 }))
      .mockResolvedValueOnce(
        new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(processSeedBatch(prisma, new FakeBucket(), { batchSize: 2 })).resolves.toEqual({
      mirrored: 0,
      failed: 2,
      skipped404: 0,
    })

    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 'seed-5' },
      data: {
        status: 'failed',
        lastError: 'Error: upstream 503',
      },
    })
    expect(update).toHaveBeenNthCalledWith(4, {
      where: { id: 'seed-6' },
      data: {
        status: 'failed',
        lastError: 'Error: non_image_response',
      },
    })
  })
})
