import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'

const TRACKED_OUTCOMES = [
  'cache_hit_cf',
  'cache_hit_r2_primary',
  'cache_hit_r2_fallback',
  'cache_miss_all',
  'cache_full_miss_failed',
] as const

const R2_HIT_OUTCOMES = ['cache_hit_r2_primary', 'cache_hit_r2_fallback'] as const

type TrackedOutcome = (typeof TRACKED_OUTCOMES)[number]

type WindowKey = '1h' | '24h'

const WINDOWS: Record<WindowKey, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
}

type WindowSummary = {
  total: number
  outcomes: Record<TrackedOutcome | 'other', number>
  r2HitRatio: number | null
}

async function readWindow(deps: AnitabiApiDeps, since: Date): Promise<WindowSummary> {
  const grouped = await deps.prisma.mapImageDiagEvent.groupBy({
    by: ['outcome'],
    where: {
      stage: 'image_cache_state',
      createdAt: { gt: since },
    },
    _count: { _all: true },
  })

  const outcomes: WindowSummary['outcomes'] = {
    cache_hit_cf: 0,
    cache_hit_r2_primary: 0,
    cache_hit_r2_fallback: 0,
    cache_miss_all: 0,
    cache_full_miss_failed: 0,
    other: 0,
  }

  let total = 0
  for (const row of grouped) {
    const count = row._count._all ?? 0
    total += count
    const key = row.outcome
    if (typeof key === 'string' && (TRACKED_OUTCOMES as readonly string[]).includes(key)) {
      outcomes[key as TrackedOutcome] += count
    } else {
      outcomes.other += count
    }
  }

  const r2Hits = R2_HIT_OUTCOMES.reduce((sum, key) => sum + outcomes[key], 0)
  const r2HitRatio = total > 0 ? r2Hits / total : null

  return { total, outcomes, r2HitRatio }
}

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET() {
      const session = await deps.getSession()
      if (!session?.user?.isAdmin) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }

      const now = deps.now()
      const since1h = new Date(now.getTime() - WINDOWS['1h'])
      const since24h = new Date(now.getTime() - WINDOWS['24h'])

      const [last1h, last24h] = await Promise.all([
        readWindow(deps, since1h),
        readWindow(deps, since24h),
      ])

      return NextResponse.json({
        windows: {
          '1h': last1h,
          '24h': last24h,
        },
        sliTarget: 0.8,
      })
    },
  }
}
