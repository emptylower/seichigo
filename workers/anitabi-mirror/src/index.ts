import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'
import { cronDelta } from '@/lib/anitabi/mirror/delta'
import { cronTick, type CronTickPrisma } from '@/lib/anitabi/mirror/cronTick'

import { createMirrorPrismaClient } from './prisma'

export type MirrorWorkerEnv = {
  DATABASE_URL: string
  MAP_IMAGE_CACHE: R2Bucket
  MAP_IMAGE_MIRROR_CRON_ENABLED: '0' | '1'
  /** 主站 origin，用于把 cron 触发转发给主 worker。 */
  SEICHIGO_ORIGIN?: string
  /** 与主站 ANITABI_CRON_SECRET 对齐，用于调用 /api/cron/anitabi/*。 */
  ANITABI_CRON_SECRET?: string
  /** 与主站 OPS_CRON_SECRET 对齐，用于调用 /api/cron/ops/*。 */
  OPS_CRON_SECRET?: string
}

/**
 * 把 cron 触发转发给主站。主站 .open-next/worker.js 只导出 fetch、没有 scheduled，
 * 所以不能直接在 wrangler.jsonc 加 triggers；挂到这个已有 scheduled 的 worker 上。
 * anitabi 端点鉴权走 x-anitabi-cron-secret，ops 端点走 x-ops-cron-secret。
 */
async function triggerMainSiteCron(
  env: MirrorWorkerEnv,
  path: string,
  secretHeader: 'x-anitabi-cron-secret' | 'x-ops-cron-secret',
  secret: string | undefined,
): Promise<void> {
  const origin = String(env.SEICHIGO_ORIGIN || '').replace(/\/+$/, '')
  const token = String(secret || '').trim()
  if (!origin || !token) {
    console.warn(`[cron] skip ${path}: SEICHIGO_ORIGIN or secret not configured`)
    return
  }
  try {
    const res = await fetch(`${origin}${path}`, {
      headers: { [secretHeader]: token },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error(`[cron] trigger ${path} failed`, res.status, await res.text())
    } else {
      console.log(`[cron] trigger ${path} ok`)
    }
  } catch (error) {
    console.error(`[cron] trigger ${path} error`, error)
  }
}

export default {
  async scheduled(controller: ScheduledController, env: MirrorWorkerEnv, ctx: ExecutionContext): Promise<void> {
    // 主站 cron 触发与镜像逻辑无关，必须先于镜像的 kill switch 触发 ——
    // 否则把 MAP_IMAGE_MIRROR_CRON_ENABLED 关掉会连带停掉翻译/同步/ops 日报。
    if (controller.cron === '0 * * * *') {
      ctx.waitUntil(triggerMainSiteCron(env, '/api/cron/anitabi/daily', 'x-anitabi-cron-secret', env.ANITABI_CRON_SECRET))
    } else if (controller.cron === '15 3 * * *') {
      // 原 vercel.json 的 25 3（translate）与 0 0（ops）两条 daily，合并到同一 tick。
      ctx.waitUntil(triggerMainSiteCron(env, '/api/cron/anitabi/translate', 'x-anitabi-cron-secret', env.ANITABI_CRON_SECRET))
      ctx.waitUntil(triggerMainSiteCron(env, '/api/cron/ops/daily', 'x-ops-cron-secret', env.OPS_CRON_SECRET))
    }

    if (String(env.MAP_IMAGE_MIRROR_CRON_ENABLED) !== '1') {
      console.log('[mirror] cron disabled by flag')
      return
    }

    const prisma = createMirrorPrismaClient(env.DATABASE_URL)

    try {
      if (controller.cron === '0 * * * *') {
        const result = await cronDelta(prisma)
        console.log(`[mirror] delta tick enqueued=${result.enqueued}`)
      } else if (controller.cron === '15 3 * * *') {
        // 本 tick 只负责主站 cron（上面已触发），镜像无任务。
      } else {
        // */5 * * * *：镜像队列
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
} satisfies ExportedHandler<MirrorWorkerEnv>
