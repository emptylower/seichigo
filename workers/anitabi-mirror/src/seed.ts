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

type SeedBatchUpdateManyResult = {
  count: number
}

type SeedBatchOwnershipRow = {
  id: string
}

export type ProcessSeedBatchPrisma = {
  mapImageMirrorState: {
    findMany(args: {
      where: { status: 'pending' }
      orderBy: { createdAt: 'asc' }
      take: number
    }): Promise<SeedBatchRow[]>
    findFirst(args: {
      where: { id: string; status: 'in_progress'; lastAttemptAt: Date }
      select: { id: true }
    }): Promise<SeedBatchOwnershipRow | null>
    updateMany(args: {
      where:
        | { id: string; status: 'pending' }
        | { id: string; status: 'in_progress'; lastAttemptAt: Date }
      data: SeedBatchUpdateData
    }): Promise<SeedBatchUpdateManyResult>
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
  retried: number
}

function createFetchTimeout(): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, FETCH_TIMEOUT_MS)

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
    },
  }
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

async function claimSeedItem(
  prisma: ProcessSeedBatchPrisma,
  itemId: string,
  claimTime: Date,
): Promise<boolean> {
  const result = await prisma.mapImageMirrorState.updateMany({
    where: { id: itemId, status: 'pending' },
    data: {
      status: 'in_progress',
      lastAttemptAt: claimTime,
      attempts: { increment: 1 },
    },
  })

  return result.count === 1
}

async function finalizeSeedItem(
  prisma: ProcessSeedBatchPrisma,
  itemId: string,
  claimTime: Date,
  data: SeedBatchUpdateData,
): Promise<boolean> {
  const result = await prisma.mapImageMirrorState.updateMany({
    where: {
      id: itemId,
      status: 'in_progress',
      lastAttemptAt: claimTime,
    },
    data,
  })

  return result.count === 1
}

async function ownsSeedItem(
  prisma: ProcessSeedBatchPrisma,
  itemId: string,
  claimTime: Date,
): Promise<boolean> {
  const row = await prisma.mapImageMirrorState.findFirst({
    where: {
      id: itemId,
      status: 'in_progress',
      lastAttemptAt: claimTime,
    },
    select: { id: true },
  })

  return row !== null
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
    retried: 0,
  }

  for (const [index, item] of items.entries()) {
    const claimTime = new Date()
    const nextAttempt = (item.attempts ?? 0) + 1

    const claimed = await claimSeedItem(prisma, item.id, claimTime)
    if (!claimed) {
      continue
    }

    try {
      const timeout = createFetchTimeout()

      try {
        const response = await fetch(item.canonicalUrl, {
          headers: { 'user-agent': userAgent },
          signal: timeout.signal,
        })

        if (response.status === 404) {
          const skipped = await finalizeSeedItem(prisma, item.id, claimTime, {
            status: 'skipped_404',
          })
          if (skipped) {
            result.skipped404 += 1
          }
        } else {
          if (!response.ok) {
            throw new Error(`upstream ${response.status}`)
          }

          const mimeType = String(response.headers.get('content-type') || '').trim()
          if (!mimeType.toLowerCase().startsWith('image/')) {
            throw new Error('non_image_response')
          }

          const bytes = await response.arrayBuffer()
          const stillOwned = await ownsSeedItem(prisma, item.id, claimTime)
          if (!stillOwned) {
            continue
          }

          const mirrored = await putMirroredImage(
            bucket,
            item.canonicalUrl,
            bytes,
            mimeType,
            'cron-seed',
          )

          const completed = await finalizeSeedItem(prisma, item.id, claimTime, {
            status: 'mirrored',
            mirroredAt: new Date(),
            contentBytes: mirrored.existingSize ?? mirrored.bytesWritten,
            lastError: null,
          })
          if (completed) {
            result.mirrored += 1
          }
        }
      } finally {
        timeout.cleanup()
      }
    } catch (error) {
      const maxedOut = nextAttempt >= MAX_ATTEMPTS

      const completed = await finalizeSeedItem(prisma, item.id, claimTime, {
        status: maxedOut ? 'failed' : 'pending',
        lastError: toErrorMessage(error),
      })

      if (!completed) {
        continue
      }

      if (maxedOut) {
        result.failed += 1
      } else {
        result.retried += 1
      }
    }

    if (delayMs > 0 && index < items.length - 1) {
      await sleep(delayMs)
    }
  }

  return result
}
