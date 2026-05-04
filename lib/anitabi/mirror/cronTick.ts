import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

import { advanceBootstrap, type AdvanceBootstrapPrisma } from './bootstrap'
import { reclaimStale, type ReclaimPrisma } from './reclaim'
import { processSeedBatch, type ProcessSeedBatchPrisma } from './seed'
import { isThrottled, type ThrottlePrisma } from './throttle'

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
  & Pick<ThrottlePrisma['mapImageMirrorState'], 'findUnique'>

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

export async function cronTick(
  prisma: CronTickPrisma,
  bucket: R2MirrorBucket,
  opts: { source: 'auto' | 'manual' },
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
    await advanceBootstrap(prisma, opts.source === 'manual' ? 5000 : 2000)
  }

  const seeded = await processSeedBatch(prisma, bucket, {
    batchSize: 100,
    perRequestDelayMs: 200,
  })

  return {
    reclaimed: reclaimed.count,
    ...seeded,
    throttled: false,
  }
}
