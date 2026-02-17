import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { fetchJsonWithRetry } from '@/lib/anitabi/source/client'
import type { RawBangumi } from '@/lib/anitabi/source/normalize'
import { buildAnitabiSyncDiffSummary } from '@/lib/anitabi/sync/diff'
import { clampInt, normalizeText } from '@/lib/anitabi/utils'

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const url = new URL(req.url)
      const sample = clampInt(url.searchParams.get('sample'), 8, 1, 30)

      const [sourceRows, localRows, pointCounts, activeDatasetCursor] = await Promise.all([
        fetchJsonWithRetry<RawBangumi[]>(`${deps.getApiBase()}/bangumi`),
        deps.prisma.anitabiBangumi.findMany({
          select: {
            id: true,
            titleZh: true,
            titleJaRaw: true,
            sourceModifiedMs: true,
            mapEnabled: true,
            meta: { select: { pointsLength: true } },
            mappings: {
              select: {
                animeId: true,
                cityId: true,
                anime: { select: { hidden: true } },
              },
            },
          },
        }),
        deps.prisma.anitabiPoint.groupBy({
          by: ['bangumiId'],
          _count: { _all: true },
        }),
        deps.prisma.anitabiSourceCursor.findUnique({
          where: { sourceName: 'activeDatasetVersion' },
          select: { value: true },
        }),
      ])

      const importedPointCountByBangumi = new Map(
        pointCounts.map((row) => [row.bangumiId, row._count._all])
      )

      const sourceSnapshot = (Array.isArray(sourceRows) ? sourceRows : [])
        .map((row) => {
          const id = Number(row?.id)
          if (!Number.isFinite(id)) return null
          const modified = Number(row?.modified)
          return {
            id,
            title: normalizeText(row?.cn) || normalizeText(row?.title) || `#${id}`,
            sourceModifiedMs: Number.isFinite(modified) ? modified : null,
          }
        })
        .filter(Boolean) as Array<{
        id: number
        title: string
        sourceModifiedMs: number | null
      }>

      const localSnapshot = localRows.map((row) => ({
        id: row.id,
        title: normalizeText(row.titleZh) || normalizeText(row.titleJaRaw) || `#${row.id}`,
        sourceModifiedMs: row.sourceModifiedMs ?? null,
        expectedPoints: Number(row.meta?.pointsLength || 0),
        importedPoints: Number(importedPointCountByBangumi.get(row.id) || 0),
      }))

      const diff = buildAnitabiSyncDiffSummary(sourceSnapshot, localSnapshot, sample)

      const mapEnabledWorks = localRows.filter((row) => row.mapEnabled).length
      const mapDisabledWorks = Math.max(localRows.length - mapEnabledWorks, 0)
      const mappedEnabledWorkIds = new Set<number>()
      const hiddenAnimeLinkedWorkIds = new Set<number>()

      for (const row of localRows) {
        if (!row.mapEnabled) continue
        let hasMapping = false
        for (const mapping of row.mappings || []) {
          if (mapping.animeId || mapping.cityId) {
            hasMapping = true
          }
          if (mapping.anime?.hidden) {
            hiddenAnimeLinkedWorkIds.add(row.id)
          }
        }
        if (hasMapping) mappedEnabledWorkIds.add(row.id)
      }

      const mappedWorks = mappedEnabledWorkIds.size
      const unmappedWorks = Math.max(mapEnabledWorks - mappedWorks, 0)

      return NextResponse.json({
        ok: true,
        diff: {
          ...diff,
          activeDatasetVersion: normalizeText(activeDatasetCursor?.value) || 'unknown',
          status: {
            mapEnabledWorks,
            mapDisabledWorks,
            mappedWorks,
            unmappedWorks,
            hiddenAnimeLinkedWorks: hiddenAnimeLinkedWorkIds.size,
          },
          checkedAt: deps.now().toISOString(),
        },
      })
    },
  }
}
