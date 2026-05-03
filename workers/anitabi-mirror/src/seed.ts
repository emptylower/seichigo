import { putMirroredImage, type R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

const DEFAULT_USER_AGENT = 'SeichiGoMirror/1.0 (+https://seichigo.com)'
const FETCH_TIMEOUT_MS = 15_000
const MAX_ATTEMPTS = 5
const MAX_ERROR_LENGTH = 500

type SeedBatchRow = {
  id: string
  canonicalUrl: string
  attempts: number | null
}

type SeedBatchUpdateData = {
  status: 'pending' | 'in_progress' | 'mirrored' | 'failed' | 'skipped_404'
  attempts?: { increment: 1 }
  lastAttemptAt?: Date
  mirroredAt?: Date
  contentBytes?: number
  lastError?: string | null
}

export type ProcessSeedBatchPrisma = {
  mapImageMirrorState: {
    findMany(args: {
      where: { status: 'pending' }
      orderBy: { createdAt: 'asc' }
      take: number
    }): Promise<SeedBatchRow[]>
    update(args: {
      where: { id: string }
      data: SeedBatchUpdateData
    }): Promise<unknown>
  }
}

export type ProcessSeedBatchOptions = {
  batchSize: number
  perRequestDelayMs?: number
  userAgent?: string
}

export type ProcessSeedBatchResult = {
  mirrored: number
  failed: number
  skipped404: number
}

function buildTimeoutSignal(): AbortSignal | undefined {
  const abortSignal = globalThis.AbortSignal as typeof AbortSignal & {
    timeout?: (ms: number) => AbortSignal
  }
  return typeof abortSignal?.timeout === 'function'
    ? abortSignal.timeout(FETCH_TIMEOUT_MS)
    : undefined
}

function normalizeDelay(delayMs: number | undefined): number {
  if (!Number.isFinite(delayMs)) {
    return 0
  }

  return Math.max(0, delayMs || 0)
}

function toErrorMessage(error: unknown): string {
  return String(error).slice(0, MAX_ERROR_LENGTH)
}

function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

export async function processSeedBatch(
  prisma: ProcessSeedBatchPrisma,
  bucket: R2MirrorBucket,
  opts: ProcessSeedBatchOptions,
): Promise<ProcessSeedBatchResult> {
  if (!Number.isFinite(opts.batchSize) || opts.batchSize <= 0) {
    throw new RangeError('batchSize must be a finite positive number')
  }

  const delayMs = normalizeDelay(opts.perRequestDelayMs)
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT
  const items = await prisma.mapImageMirrorState.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: opts.batchSize,
  })
  const result: ProcessSeedBatchResult = {
    mirrored: 0,
    failed: 0,
    skipped404: 0,
  }

  for (const [index, item] of items.entries()) {
    const now = new Date()
    const nextAttempt = (item.attempts ?? 0) + 1

    await prisma.mapImageMirrorState.update({
      where: { id: item.id },
      data: {
        status: 'in_progress',
        lastAttemptAt: now,
        attempts: { increment: 1 },
      },
    })

    try {
      const response = await fetch(item.canonicalUrl, {
        headers: { 'user-agent': userAgent },
        signal: buildTimeoutSignal(),
      })

      if (response.status === 404) {
        await prisma.mapImageMirrorState.update({
          where: { id: item.id },
          data: { status: 'skipped_404' },
        })
        result.skipped404 += 1
      } else {
        if (!response.ok) {
          throw new Error(`upstream ${response.status}`)
        }

        const mimeType = String(response.headers.get('content-type') || '').trim()
        if (!mimeType.toLowerCase().startsWith('image/')) {
          throw new Error('non_image_response')
        }

        const bytes = await response.arrayBuffer()
        const mirrored = await putMirroredImage(
          bucket,
          item.canonicalUrl,
          bytes,
          mimeType,
          'cron-seed',
        )

        await prisma.mapImageMirrorState.update({
          where: { id: item.id },
          data: {
            status: 'mirrored',
            mirroredAt: new Date(),
            contentBytes: mirrored.bytesWritten,
            lastError: null,
          },
        })
        result.mirrored += 1
      }
    } catch (error) {
      const maxedOut = nextAttempt >= MAX_ATTEMPTS

      await prisma.mapImageMirrorState.update({
        where: { id: item.id },
        data: {
          status: maxedOut ? 'failed' : 'pending',
          lastError: toErrorMessage(error),
        },
      })

      if (maxedOut) {
        result.failed += 1
      }
    }

    if (delayMs > 0 && index < items.length - 1) {
      await sleep(delayMs)
    }
  }

  return result
}
