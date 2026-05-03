import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'

const MIRROR_TOTAL_KEYS = ['pending', 'in_progress', 'mirrored', 'failed', 'skipped_404'] as const

type MirrorTotalKey = (typeof MIRROR_TOTAL_KEYS)[number]

type MirrorTotals = Record<'all' | MirrorTotalKey, number>

async function readTotals(deps: AnitabiApiDeps): Promise<MirrorTotals> {
  const grouped = await deps.prisma.mapImageMirrorState.groupBy({
    by: ['status'],
    _count: { _all: true },
  })

  const totals: MirrorTotals = {
    all: 0,
    pending: 0,
    in_progress: 0,
    mirrored: 0,
    failed: 0,
    skipped_404: 0,
  }

  for (const row of grouped) {
    totals.all += row._count._all
    if (MIRROR_TOTAL_KEYS.includes(row.status as MirrorTotalKey)) {
      totals[row.status as MirrorTotalKey] = row._count._all
    }
  }

  return totals
}

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET() {
      const session = await deps.getSession()
      if (!session?.user?.isAdmin) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }

      const now = deps.now()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      const [totals, bootstrap, recentFailures, mirroredLast1h, mirroredLast24h] = await Promise.all([
        readTotals(deps),
        deps.prisma.mapImageMirrorBootstrap.findUnique({
          where: { id: 1 },
        }),
        deps.prisma.mapImageMirrorState.findMany({
          where: { status: 'failed' },
          orderBy: { lastAttemptAt: 'desc' },
          take: 10,
          select: {
            canonicalUrl: true,
            lastError: true,
            attempts: true,
            lastAttemptAt: true,
          },
        }),
        deps.prisma.mapImageMirrorState.count({
          where: {
            status: 'mirrored',
            mirroredAt: { gt: oneHourAgo },
          },
        }),
        deps.prisma.mapImageMirrorState.count({
          where: {
            status: 'mirrored',
            mirroredAt: { gt: oneDayAgo },
          },
        }),
      ])

      const remaining = totals.pending + totals.in_progress
      const ratePerSec = mirroredLast1h / 3600
      const estimatedRemainingHours = ratePerSec === 0
        ? null
        : remaining / ratePerSec / 3600

      return NextResponse.json({
        totals,
        bootstrap,
        recentFailures,
        rates: {
          remaining,
          mirroredLast1h,
          mirroredLast24h,
          ratePerSec,
          estimatedRemainingHours,
        },
      })
    },
  }
}
