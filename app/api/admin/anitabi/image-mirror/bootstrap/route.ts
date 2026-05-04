export const runtime = 'nodejs'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { getAnitabiApiDeps, type AnitabiApiDeps } from '@/lib/anitabi/api'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'
import { cronTick, type CronTickPrisma } from '@/lib/anitabi/mirror/cronTick'
import { clearThrottle, type ThrottlePrisma } from '@/lib/anitabi/mirror/throttle'

type BootstrapMode = 'advance' | 'force-complete'

type BootstrapRow = Awaited<ReturnType<AnitabiApiDeps['prisma']['mapImageMirrorBootstrap']['findUnique']>>

function routeError(err: unknown) {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试' }, { status: 503 })
  }

  const message = String((err as { message?: unknown } | null)?.message || '')
  if (
    message.includes('MAP_IMAGE_CACHE is not configured')
    || message.includes('mirror bucket is not configured')
  ) {
    return NextResponse.json({ error: 'R2 缓存桶未配置' }, { status: 503 })
  }

  if (
    message.includes('Environment variable not found')
    && message.includes('DATABASE_URL')
  ) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }

  // Admin-only route — surface the actual error so the operator can see
  // what's happening instead of a generic "Internal server error" wall.
  return NextResponse.json(
    {
      error: 'Internal server error',
      detail: message || String(err),
      code: typeof code === 'string' || typeof code === 'number' ? code : undefined,
    },
    { status: 500 },
  )
}

async function readMode(req: Request): Promise<BootstrapMode> {
  try {
    const raw = await req.text()
    if (!raw.trim()) return 'advance'

    const parsed = JSON.parse(raw) as { mode?: unknown }
    return parsed.mode === 'force-complete' ? 'force-complete' : 'advance'
  } catch {
    return 'advance'
  }
}

function getMirrorBucket(deps: AnitabiApiDeps): R2MirrorBucket {
  const bindings = getCfBindings()
  const bucket = deps.env?.MAP_IMAGE_CACHE || bindings?.env?.MAP_IMAGE_CACHE
  if (!bucket) {
    throw new Error('MAP_IMAGE_CACHE is not configured')
  }

  return bucket
}

async function readBootstrap(deps: AnitabiApiDeps): Promise<BootstrapRow> {
  return deps.prisma.mapImageMirrorBootstrap.findUnique({
    where: { id: 1 },
  })
}

async function readTotals(deps: AnitabiApiDeps): Promise<Record<string, number>> {
  const grouped = await deps.prisma.mapImageMirrorState.groupBy({
    by: ['status'],
    _count: { _all: true },
  })

  return Object.fromEntries(grouped.map((row) => [row.status, row._count._all]))
}

function isBootstrapComplete(bootstrap: BootstrapRow): boolean {
  return Boolean(bootstrap?.bangumiCompleted && bootstrap?.pointCompleted)
}

export async function POST(req: Request) {
  const startedAt = Date.now()

  try {
    const deps = await getAnitabiApiDeps()
    const session = await deps.getSession()

    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const mode = await readMode(req)
    const bucket = getMirrorBucket(deps)

    // Operator override: any manual click clears the circuit breaker so the
    // tick that follows actually runs. The breaker auto-rearms on the next
    // batch of upstream timeouts, so this isn't a permanent bypass — it's
    // just "operator says try again now."
    await clearThrottle(deps.prisma as unknown as ThrottlePrisma)

    // Single drain per click. The previous loop ran cronTick repeatedly
    // until a 25s budget exhausted, but cronTick itself takes ~22s
    // (batchSize 100 × perRequestDelayMs 200ms in processSeedBatch) so
    // the second iteration plus post-loop work overran Cloudflare's 30s
    // request lifetime and CF returned 502 — even though every drained
    // row was already committed mid-loop. Auto cron handles the repeat
    // cadence; manual is a kick + circuit-breaker clear.
    void mode
    // Smaller batch + tighter delay so the whole request fits comfortably
    // inside the Workers 30s wall clock, even with anitabi being slow to
    // respond. Auto cron keeps the larger 100/200ms cadence since it has
    // 5 minutes between firings.
    await cronTick(deps.prisma as unknown as CronTickPrisma, bucket, {
      source: 'manual',
      seedBatchSize: 50,
      seedDelayMs: 100,
    })
    const finalBootstrap = await readBootstrap(deps)
    const totals = await readTotals(deps)
    const elapsedMs = Date.now() - startedAt

    return NextResponse.json({
      bootstrap: finalBootstrap,
      totals,
      elapsedMs,
      stillNeedsManualPush: !isBootstrapComplete(finalBootstrap),
    })
  } catch (err) {
    console.error('[api/admin/anitabi/image-mirror/bootstrap] POST failed', err)
    return routeError(err)
  }
}
