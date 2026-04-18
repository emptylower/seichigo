import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { fetchJsonWithRetry } from '@/lib/anitabi/source/client'
import { normalizeText } from '@/lib/anitabi/utils'

type ProgressMode = 'exact' | 'estimated' | 'unknown'

function toIntOrNull(value: string | null | undefined): number | null {
  const n = Number.parseInt(String(value || '').trim(), 10)
  return Number.isFinite(n) ? n : null
}

function clampRate(value: number | null): number | null {
  if (value == null || Number.isNaN(value)) return null
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET() {
      const session = await deps.getSession()
      if (!session?.user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const [sourceBangumiCursor, activeDatasetCursor, importedBangumi, importedMapEnabled, importedPoints, expectedPointsAgg, latestRun, runningCount] = await Promise.all([
        deps.prisma.anitabiSourceCursor.findUnique({ where: { sourceName: 'bangumi' }, select: { value: true } }),
        deps.prisma.anitabiSourceCursor.findUnique({ where: { sourceName: 'activeDatasetVersion' }, select: { value: true } }),
        deps.prisma.anitabiBangumi.count(),
        deps.prisma.anitabiBangumi.count({ where: { mapEnabled: true } }),
        deps.prisma.anitabiPoint.count(),
        deps.prisma.anitabiBangumiMeta.aggregate({ _sum: { pointsLength: true } }),
        deps.prisma.anitabiSyncRun.findFirst({
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            mode: true,
            status: true,
            changedCount: true,
            startedAt: true,
            endedAt: true,
            errorSummary: true,
          },
        }),
        deps.prisma.anitabiSyncRun.count({ where: { status: { in: ['running', 'partial'] } } }),
      ])

      let sourceBangumiTotal = toIntOrNull(sourceBangumiCursor?.value)
      if (sourceBangumiTotal == null) {
        const bangumiRows = (await fetchJsonWithRetry<Array<{ id?: number }>>(`${deps.getApiBase()}/bangumi`)) || []
        sourceBangumiTotal = bangumiRows.length
      }

      const expectedPointsInImportedBangumi = Number(expectedPointsAgg._sum.pointsLength || 0)

      let pointTotalMode: ProgressMode = 'unknown'
      let pointTotal: number | null = null

      if (sourceBangumiTotal > 0 && importedBangumi >= sourceBangumiTotal) {
        pointTotalMode = 'exact'
        pointTotal = expectedPointsInImportedBangumi
      } else if (sourceBangumiTotal > 0 && importedBangumi > 0 && expectedPointsInImportedBangumi > 0) {
        pointTotalMode = 'estimated'
        const avgPerWork = expectedPointsInImportedBangumi / importedBangumi
        pointTotal = Math.max(expectedPointsInImportedBangumi, Math.round(avgPerWork * sourceBangumiTotal))
      }

      const pendingBangumi = sourceBangumiTotal > 0 ? Math.max(sourceBangumiTotal - importedBangumi, 0) : null
      const pendingPoints = pointTotal != null ? Math.max(pointTotal - importedPoints, 0) : null

      const worksCompletionRate = sourceBangumiTotal > 0 ? clampRate(importedBangumi / sourceBangumiTotal) : null
      const pointsCompletionRate = pointTotal && pointTotal > 0 ? clampRate(importedPoints / pointTotal) : null
      const importedPointCoverageRate =
        expectedPointsInImportedBangumi > 0
          ? clampRate(importedPoints / expectedPointsInImportedBangumi)
          : importedBangumi > 0
            ? 1
            : null

      return NextResponse.json({
        ok: true,
        progress: {
          activeDatasetVersion: normalizeText(activeDatasetCursor?.value) || 'unknown',
          sourceBangumiTotal,
          importedBangumi,
          importedMapEnabled,
          pendingBangumi,
          importedPoints,
          expectedPointsInImportedBangumi,
          pointTotal,
          pointTotalMode,
          pendingPoints,
          worksCompletionRate,
          pointsCompletionRate,
          importedPointCoverageRate,
          latestRun: latestRun
            ? {
                ...latestRun,
                startedAt: latestRun.startedAt.toISOString(),
                endedAt: latestRun.endedAt ? latestRun.endedAt.toISOString() : null,
              }
            : null,
          updatedAt: deps.now().toISOString(),
          isRunning: runningCount > 0,
        },
      })
    },
  }
}
