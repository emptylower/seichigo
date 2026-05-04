import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

import { advanceBootstrap, type AdvanceBootstrapPrisma } from './bootstrap'
import { reclaimStale, type ReclaimPrisma } from './reclaim'
import { processSeedBatch, type ProcessSeedBatchPrisma } from './seed'
import { isThrottled, recordTimeout, type ThrottlePrisma } from './throttle'

const MIRROR_LOCK_KEY = 4242420 as const

type BootstrapStatusRow = {
  bangumiCompleted: boolean
  pointCompleted: boolean
}

type BootstrapStatusPrisma = {
  mapImageMirrorBootstrap: AdvanceBootstrapPrisma['mapImageMirrorBootstrap'] & {
    findUnique(args: { where: { id: number } }): Promise<BootstrapStatusRow | null>
  }
}

type CronTickMirrorStatePrisma =
  & AdvanceBootstrapPrisma['mapImageMirrorState']
  & ReclaimPrisma['mapImageMirrorState']
  & ProcessSeedBatchPrisma['mapImageMirrorState']
  & ThrottlePrisma['mapImageMirrorState']

type AdvisoryLockPrisma = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
}

export type CronTickPrisma =
  & Omit<AdvanceBootstrapPrisma, 'mapImageMirrorBootstrap' | 'mapImageMirrorState'>
  & BootstrapStatusPrisma
  & AdvisoryLockPrisma
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
  | {
      reclaimed: 0
      mirrored: 0
      failed: 0
      skipped404: 0
      retried: 0
      throttled: false
      skipped: 'lock_busy'
    }

async function tryAcquireMirrorLock(prisma: CronTickPrisma): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${MIRROR_LOCK_KEY}) AS locked`
    return Array.isArray(rows) && rows.length > 0 && rows[0]?.locked === true
  } catch (err) {
    console.warn('[mirror] advisory lock probe failed; running without lock', err)
    return true
  }
}

async function releaseMirrorLock(prisma: CronTickPrisma): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${MIRROR_LOCK_KEY})`
  } catch (err) {
    console.warn('[mirror] advisory unlock failed', err)
  }
}

export async function cronTick(
  prisma: CronTickPrisma,
  bucket: R2MirrorBucket,
  opts: { source: 'auto' | 'manual' },
): Promise<CronTickResult> {
  const acquired = await tryAcquireMirrorLock(prisma)
  if (!acquired) {
    if (opts.source === 'manual') {
      throw new Error('mirror cron is already running; retry in ~30s')
    }
    return {
      reclaimed: 0,
      mirrored: 0,
      failed: 0,
      skipped404: 0,
      retried: 0,
      throttled: false,
      skipped: 'lock_busy',
    }
  }

  try {
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
      await advanceBootstrap(prisma, opts.source === 'manual' ? 5000 : 2000)
    }

    const seeded = await processSeedBatch(prisma, bucket, {
      batchSize: 100,
      perRequestDelayMs: 200,
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
  } finally {
    await releaseMirrorLock(prisma)
  }
}
