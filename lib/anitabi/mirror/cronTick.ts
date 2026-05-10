import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

import { advanceBootstrap, type AdvanceBootstrapPrisma } from './bootstrap'
import { reclaimStale, type ReclaimPrisma } from './reclaim'
import { processSeedBatch, type ProcessSeedBatchPrisma } from './seed'
import { isThrottled, recordTimeout, type ThrottlePrisma } from './throttle'

// Bootstrap enumerates source rows ~50× faster than the seed batch can drain
// them, so without a gate every auto tick piles thousands of new pending rows
// onto the queue. Skip the advance step whenever the queue already holds at
// least this many pending rows; the next tick will check again once the
// worker has chewed through some of them.
const PENDING_BACKLOG_THRESHOLD = 1000

type BootstrapStatusRow = {
  bangumiCompleted: boolean
  pointCompleted: boolean
}

type BootstrapStatusPrisma = {
  mapImageMirrorBootstrap: AdvanceBootstrapPrisma['mapImageMirrorBootstrap'] & {
    findUnique(args: { where: { id: number } }): Promise<BootstrapStatusRow | null>
  }
}

type BacklogCountPrisma = {
  count(args: { where: { status: 'pending' } }): Promise<number>
}

type CronTickMirrorStatePrisma =
  & AdvanceBootstrapPrisma['mapImageMirrorState']
  & ReclaimPrisma['mapImageMirrorState']
  & ProcessSeedBatchPrisma['mapImageMirrorState']
  & ThrottlePrisma['mapImageMirrorState']
  & BacklogCountPrisma

export type CronTickPrisma =
  & Omit<AdvanceBootstrapPrisma, 'mapImageMirrorBootstrap' | 'mapImageMirrorState'>
  & BootstrapStatusPrisma
  & {
    mapImageMirrorState: CronTickMirrorStatePrisma
  }

export type CronTickResult =
  | {
      reclaimed: number
      mirrored: number
      failed: number
      skipped404: number
      throttled: true
    }
  | {
      reclaimed: number
      mirrored: number
      failed: number
      skipped404: number
      retried: number
      throttled: false
    }

// Concurrency note: the previous implementation wrapped this body in a
// pg_try_advisory_lock() probe to serialize the auto cron against manual
// force-complete clicks. That used pg_try_advisory_lock (session-scoped)
// which is incompatible with Neon's pgbouncer-style pooler — every prisma
// $queryRaw can land on a different pool connection, so the lock acquired
// on connection A could never be re-checked from connection B and the
// route's loop ended up blocking against itself. Until the mirror worker
// actually deploys and we have real concurrency to defend against, rely
// on reclaimStale()'s 5min watermark as the single concurrency safety
// net. When we add the worker, switch to pg_try_advisory_xact_lock inside
// a $transaction so the lock release is tied to commit/rollback.
export type CronTickOptions = {
  source: 'auto' | 'manual'
  seedBatchSize?: number
  seedDelayMs?: number
}

export async function cronTick(
  prisma: CronTickPrisma,
  bucket: R2MirrorBucket,
  opts: CronTickOptions,
): Promise<CronTickResult> {
  const reclaimed = await reclaimStale(prisma)

  if (await isThrottled(prisma as unknown as ThrottlePrisma)) {
    return {
      reclaimed: reclaimed.count,
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      throttled: true,
    }
  }

  const bootstrap = await prisma.mapImageMirrorBootstrap.findUnique({
    where: { id: 1 },
  })

  if (!bootstrap?.bangumiCompleted || !bootstrap?.pointCompleted) {
    const pendingBacklog = await prisma.mapImageMirrorState.count({
      where: { status: 'pending' },
    })
    if (pendingBacklog < PENDING_BACKLOG_THRESHOLD) {
      await advanceBootstrap(prisma, opts.source === 'manual' ? 5000 : 2000)
    }
  }

  const seeded = await processSeedBatch(prisma, bucket, {
    batchSize: opts.seedBatchSize ?? 30,
    perRequestDelayMs: opts.seedDelayMs ?? 500,
  })

  if (seeded.timedOut > 0) {
    await recordTimeout(prisma, seeded.timedOut)
  }

  const { timedOut, ...seedSummary } = seeded
  void timedOut

  return {
    reclaimed: reclaimed.count,
    ...seedSummary,
    throttled: false,
  }
}
