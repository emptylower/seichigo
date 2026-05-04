import { afterEach, describe, expect, it, vi } from 'vitest'

import { computeCanonicalImageUrl, computeMirrorKey } from '@/lib/anitabi/imageNormalize'
import type { R2MirrorCustomMetadata } from '@/lib/anitabi/r2Mirror'

import { processSeedBatch, type ProcessSeedBatchPrisma } from '@/lib/anitabi/mirror/seed'

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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function buildPrismaMock(
  items: Array<{
    id: string
    canonicalUrl: string
    attempts: number | null
    createdAt: Date
  }>,
  opts?: {
    findFirstImpl?: ProcessSeedBatchPrisma['mapImageMirrorState']['findFirst']
    updateManyImpl?: ProcessSeedBatchPrisma['mapImageMirrorState']['updateMany']
  },
) {
  const findMany = vi
    .fn<ProcessSeedBatchPrisma['mapImageMirrorState']['findMany']>()
    .mockResolvedValue(items)
  const findFirst = vi
    .fn<ProcessSeedBatchPrisma['mapImageMirrorState']['findFirst']>()
    .mockImplementation(async ({ where }) =>
      items.find(
        (item) =>
          item.id === where.id &&
          where.status === 'in_progress' &&
          where.lastAttemptAt instanceof Date,
      ) ?? null,
    )
  const updateMany = vi
    .fn<ProcessSeedBatchPrisma['mapImageMirrorState']['updateMany']>()
    .mockResolvedValue({ count: 1 })

  if (opts?.findFirstImpl) {
    findFirst.mockImplementation(opts.findFirstImpl)
  }

  if (opts?.updateManyImpl) {
    updateMany.mockImplementation(opts.updateManyImpl)
  }

  const prisma = {
    mapImageMirrorState: {
      findMany,
      findFirst,
      updateMany,
    },
  } satisfies ProcessSeedBatchPrisma

  return { prisma, findMany, findFirst, updateMany }
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

    const { prisma, findMany, updateMany } = buildPrismaMock([
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
      retried: 0,
      timedOut: 0,
    })

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 3,
    })
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'seed-1', status: 'pending' },
      data: {
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T12:00:00Z'),
        attempts: { increment: 1 },
      },
    })
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'seed-1',
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T12:00:00Z'),
      },
      data: { status: 'skipped_404' },
    })
    expect(fetchMock).toHaveBeenCalledWith('https://image.anitabi.cn/point/1.jpg', {
      headers: { 'user-agent': 'SeichiGoMirror/1.0 (+https://seichigo.com)' },
      signal: expect.any(AbortSignal),
    })
    expect(vi.getTimerCount()).toBe(0)
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
    const { prisma, updateMany } = buildPrismaMock([item])
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
      retried: 0,
      timedOut: 0,
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
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'seed-2',
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T12:30:00Z'),
      },
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
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:10:00Z'))

    const { prisma, updateMany } = buildPrismaMock([
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
      retried: 0,
      timedOut: 0,
    })

    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'seed-3',
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T12:10:00Z'),
      },
      data: { status: 'skipped_404' },
    })
  })

  it('returns retryable errors to pending when the attempt ceiling has not been reached', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:20:00Z'))

    const { prisma, updateMany } = buildPrismaMock([
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
      retried: 1,
      timedOut: 0,
    })

    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'seed-4',
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T12:20:00Z'),
      },
      data: {
        status: 'pending',
        lastError: 'Error: upstream 502',
      },
    })
  })

  it('marks max-attempt and non-image responses as failed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:40:00Z'))

    const { prisma, updateMany } = buildPrismaMock([
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
      retried: 0,
      timedOut: 0,
    })

    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'seed-5',
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T12:40:00Z'),
      },
      data: {
        status: 'failed',
        lastError: 'Error: upstream 503',
      },
    })
    expect(updateMany).toHaveBeenNthCalledWith(4, {
      where: {
        id: 'seed-6',
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T12:40:00Z'),
      },
      data: {
        status: 'failed',
        lastError: 'Error: non_image_response',
      },
    })
  })

  it('skips rows that lose the compare-and-set claim without fetching or recording counts', async () => {
    const { prisma, updateMany } = buildPrismaMock(
      [
        {
          id: 'seed-7',
          canonicalUrl: 'https://image.anitabi.cn/claimed-elsewhere.jpg',
          attempts: 0,
          createdAt: new Date('2026-05-03T12:00:00Z'),
        },
      ],
      {
        updateManyImpl: vi.fn().mockResolvedValue({ count: 0 }),
      },
    )
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    await expect(processSeedBatch(prisma, new FakeBucket(), { batchSize: 1 })).resolves.toEqual({
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      retried: 0,
      timedOut: 0,
    })

    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not count terminal outcomes when the fenced update loses ownership', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T13:00:00Z'))

    const { prisma, updateMany } = buildPrismaMock(
      [
        {
          id: 'seed-8',
          canonicalUrl: 'https://image.anitabi.cn/stale-worker.jpg',
          attempts: 2,
          createdAt: new Date('2026-05-03T12:00:00Z'),
        },
      ],
      {
        updateManyImpl: vi
          .fn<ProcessSeedBatchPrisma['mapImageMirrorState']['updateMany']>()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
    )

    await expect(processSeedBatch(prisma, new FakeBucket(), { batchSize: 1 })).resolves.toEqual({
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      retried: 0,
      timedOut: 0,
    })

    expect(updateMany).toHaveBeenCalledTimes(2)
  })

  it('skips the R2 write when ownership is lost after reading the upstream image', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T13:05:00Z'))

    const bucket = new FakeBucket()
    const { prisma, findFirst, updateMany } = buildPrismaMock(
      [
        {
          id: 'seed-8b',
          canonicalUrl: 'https://image.anitabi.cn/stolen-before-r2.jpg',
          attempts: 1,
          createdAt: new Date('2026-05-03T12:00:00Z'),
        },
      ],
      {
        findFirstImpl: vi.fn().mockResolvedValue(null),
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(encodeBytes('body-already-read'), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    )

    await expect(processSeedBatch(prisma, bucket, { batchSize: 1 })).resolves.toEqual({
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      retried: 0,
      timedOut: 0,
    })

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'seed-8b',
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T13:05:00Z'),
      },
      select: { id: true },
    })
    expect(bucket.putCalls).toBe(0)
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it('skips the R2 write when ownership is lost after mirror-key preparation starts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T13:07:00Z'))

    const bucket = new FakeBucket()
    const findFirstImpl = vi
      .fn<ProcessSeedBatchPrisma['mapImageMirrorState']['findFirst']>()
      .mockResolvedValueOnce({ id: 'seed-8c' })
      .mockResolvedValueOnce(null)
    const { prisma, findFirst, updateMany } = buildPrismaMock(
      [
        {
          id: 'seed-8c',
          canonicalUrl: 'https://image.anitabi.cn/stolen-inside-helper.jpg',
          attempts: 1,
          createdAt: new Date('2026-05-03T12:00:00Z'),
        },
      ],
      { findFirstImpl },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(encodeBytes('body-already-read'), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    )

    await expect(processSeedBatch(prisma, bucket, { batchSize: 1 })).resolves.toEqual({
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      retried: 0,
      timedOut: 0,
    })

    expect(findFirst).toHaveBeenCalledTimes(2)
    expect(findFirst).toHaveBeenLastCalledWith({
      where: {
        id: 'seed-8c',
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T13:07:00Z'),
      },
      select: { id: true },
    })
    expect(bucket.putCalls).toBe(0)
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it('persists the existing object size when R2 skips overwriting a fresh mirror', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T13:10:00Z'))

    const bucket = new FakeBucket()
    const item = {
      id: 'seed-9',
      canonicalUrl: 'https://anitabi.cn/images/bangumi/999/cover.jpg?plan=h320',
      attempts: 0,
      createdAt: new Date('2026-05-03T12:00:00Z'),
    }
    const existingBytes = encodeBytes('existing-mirror')
    const canonicalUrl = computeCanonicalImageUrl(item.canonicalUrl)
    const key = await computeMirrorKey(canonicalUrl, 'image/jpeg')

    await bucket.put(key, existingBytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {
        originalUrl: canonicalUrl,
        mimeType: 'image/jpeg',
        mirroredAt: '2026-05-03T13:05:00.000Z',
        mirrorSource: 'lazy',
        contentLength: String(existingBytes.byteLength),
      },
    })

    const { prisma, updateMany } = buildPrismaMock([item])
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(encodeBytes('newer-but-skipped'), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    )

    await expect(processSeedBatch(prisma, bucket, { batchSize: 1 })).resolves.toEqual({
      mirrored: 1,
      failed: 0,
      skipped404: 0,
      retried: 0,
      timedOut: 0,
    })

    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'seed-9',
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T13:10:00Z'),
      },
      data: {
        status: 'mirrored',
        mirroredAt: new Date('2026-05-03T13:10:00Z'),
        contentBytes: existingBytes.byteLength,
        lastError: null,
      },
    })
    expect(bucket.putCalls).toBe(1)
  })

  it('waits between items and does not sleep after the last item', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T13:20:00Z'))

    const firstFetch = createDeferred<Response>()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(firstFetch.promise)
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const { prisma } = buildPrismaMock([
      {
        id: 'seed-10',
        canonicalUrl: 'https://image.anitabi.cn/one.jpg',
        attempts: 0,
        createdAt: new Date('2026-05-03T12:00:00Z'),
      },
      {
        id: 'seed-11',
        canonicalUrl: 'https://image.anitabi.cn/two.jpg',
        attempts: 0,
        createdAt: new Date('2026-05-03T12:05:00Z'),
      },
    ])

    const runPromise = processSeedBatch(prisma, new FakeBucket(), {
      batchSize: 2,
      perRequestDelayMs: 250,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    firstFetch.resolve(new Response(null, { status: 404 }))
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(249)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await expect(runPromise).resolves.toEqual({
      mirrored: 0,
      failed: 0,
      skipped404: 2,
      retried: 0,
      timedOut: 0,
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('counts timedOut for AbortError fetch failures so the breaker can throttle', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T13:25:00Z'))

    const { prisma } = buildPrismaMock([
      {
        id: 'seed-timeout-1',
        canonicalUrl: 'https://image.anitabi.cn/slow1.jpg',
        attempts: 0,
        createdAt: new Date('2026-05-03T12:00:00Z'),
      },
      {
        id: 'seed-timeout-2',
        canonicalUrl: 'https://image.anitabi.cn/slow2.jpg',
        attempts: 0,
        createdAt: new Date('2026-05-03T12:01:00Z'),
      },
    ])

    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(abortErr))

    await expect(processSeedBatch(prisma, new FakeBucket(), { batchSize: 2 })).resolves.toEqual({
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      retried: 2,
      timedOut: 2,
    })
  })

  it('cleans up the fetch timeout when fetch rejects before returning a response', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T13:30:00Z'))

    const { prisma, updateMany } = buildPrismaMock([
      {
        id: 'seed-12',
        canonicalUrl: 'https://image.anitabi.cn/reject.jpg',
        attempts: 0,
        createdAt: new Date('2026-05-03T12:00:00Z'),
      },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new Error('socket hang up')),
    )

    await expect(processSeedBatch(prisma, new FakeBucket(), { batchSize: 1 })).resolves.toEqual({
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      retried: 1,
      timedOut: 0,
    })

    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'seed-12',
        status: 'in_progress',
        lastAttemptAt: new Date('2026-05-03T13:30:00Z'),
      },
      data: {
        status: 'pending',
        lastError: 'Error: socket hang up',
      },
    })
    expect(vi.getTimerCount()).toBe(0)
  })
})
