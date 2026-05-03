import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

import { cronDelta } from './delta'
import { cronTick, type CronTickPrisma } from './cronTick'
import { createMirrorPrismaClient } from './prisma'

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    void ctx

    if (String(env.MAP_IMAGE_MIRROR_CRON_ENABLED) !== '1') {
      console.log('[mirror] cron disabled by flag')
      return
    }

    const prisma = createMirrorPrismaClient(env.DATABASE_URL)

    try {
      if (controller.cron === '0 * * * *') {
        const result = await cronDelta(prisma)
        console.log(`[mirror] delta tick enqueued=${result.enqueued}`)
      } else {
        const bucket = env.MAP_IMAGE_CACHE as unknown as R2MirrorBucket
        const result = await cronTick(prisma as unknown as CronTickPrisma, bucket, { source: 'auto' })
        const retriedPart = 'retried' in result ? ` retried=${result.retried}` : ''

        console.log(
          `[mirror] tick reclaimed=${result.reclaimed} mirrored=${result.mirrored} failed=${result.failed} 404=${result.skipped404}${retriedPart} throttled=${result.throttled}`,
        )
      }
    } catch (error) {
      console.error('[mirror] tick failed', error)
      throw error
    } finally {
      await prisma.$disconnect()
    }
  },
} satisfies ExportedHandler<Env>
