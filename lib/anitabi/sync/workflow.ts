import type { PrismaClient } from '@prisma/client'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import type { AnitabiSyncMode, AnitabiSyncReport } from '@/lib/anitabi/types'
import { asyncPool, hashText } from '@/lib/anitabi/utils'
import { fetchJsonWithRetry, fetchTextWithRetry } from '@/lib/anitabi/source/client'
import {
  getLiteStats,
  normalizeBangumi,
  normalizeContributorsFromUsersRaw,
  normalizePoints,
  type RawBangumi,
  type RawLite,
  type RawPointDetail,
  type RawPointsSummary,
} from '@/lib/anitabi/source/normalize'
import { parseChangelogMarkdown } from '@/lib/anitabi/source/parseChangelog'
import { writeRawJson, writeRawText } from '@/lib/anitabi/sync/rawStore'

function nowVersion(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getSyncConcurrency(): number {
  const raw = Number.parseInt(String(process.env.ANITABI_SYNC_CONCURRENCY || ''), 10)
  if (!Number.isFinite(raw)) return 2
  return clampInt(raw, 1, 8)
}

async function upsertCursor(
  prisma: PrismaClient,
  sourceName: string,
  data: { value?: string | null; etag?: string | null; lastModified?: string | null }
) {
  await prisma.anitabiSourceCursor.upsert({
    where: { sourceName },
    create: {
      sourceName,
      value: data.value ?? null,
      etag: data.etag ?? null,
      lastModified: data.lastModified ?? null,
      lastSuccessAt: new Date(),
    },
    update: {
      value: data.value ?? null,
      etag: data.etag ?? null,
      lastModified: data.lastModified ?? null,
      lastSuccessAt: new Date(),
    },
  })
}

async function syncBangumiOne(
  deps: AnitabiApiDeps,
  datasetVersion: string,
  row: RawBangumi,
  dryRun: boolean
): Promise<{ changed: boolean; id: number }> {
  const bangumi = normalizeBangumi(row)
  const apiBase = deps.getApiBase()

  const detail = (await fetchJsonWithRetry<RawBangumi>(`${apiBase}/bangumi/${bangumi.id}`)) || row
  const normalized = normalizeBangumi(detail)

  const lite = await fetchJsonWithRetry<RawLite>(`${apiBase}/bangumi/${bangumi.id}/lite`, { allow404: true })
  const mapEnabled = Boolean(lite)

  let pointsSummary: RawPointsSummary | null = null
  let pointsDetail: RawPointDetail[] = []

  if (mapEnabled) {
    pointsSummary = (await fetchJsonWithRetry<RawPointsSummary>(`${apiBase}/bangumi/${bangumi.id}/points`)) || null
    pointsDetail = (await fetchJsonWithRetry<RawPointDetail[]>(`${apiBase}/bangumi/${bangumi.id}/points/detail`)) || []
  }

  const points = mapEnabled ? normalizePoints(bangumi.id, pointsDetail, pointsSummary) : []
  const liteStats = getLiteStats(lite)

  if (dryRun) {
    return { changed: true, id: bangumi.id }
  }

  await deps.prisma.anitabiBangumi.upsert({
    where: { id: normalized.id },
    create: {
      id: normalized.id,
      titleZh: normalized.titleZh,
      titleJaRaw: normalized.titleJaRaw,
      cat: normalized.cat,
      cover: normalized.cover,
      description: normalized.description,
      color: normalized.color,
      city: normalized.city,
      tags: normalized.tags,
      geoLat: normalized.geoLat,
      geoLng: normalized.geoLng,
      zoom: normalized.zoom,
      sourceModifiedMs: normalized.sourceModifiedMs,
      mapEnabled,
      datasetVersion,
    },
    update: {
      titleZh: normalized.titleZh,
      titleJaRaw: normalized.titleJaRaw,
      cat: normalized.cat,
      cover: normalized.cover,
      description: normalized.description,
      color: normalized.color,
      city: normalized.city,
      tags: normalized.tags,
      geoLat: normalized.geoLat,
      geoLng: normalized.geoLng,
      zoom: normalized.zoom,
      sourceModifiedMs: normalized.sourceModifiedMs,
      mapEnabled,
      datasetVersion,
    },
  })

  await deps.prisma.anitabiBangumiMeta.upsert({
    where: { bangumiId: normalized.id },
    create: {
      bangumiId: normalized.id,
      pointsLength: liteStats.pointsLength,
      imagesLength: liteStats.imagesLength,
      themeJson: (pointsSummary as any)?.theme ?? null,
      customEpNamesJson: (pointsSummary as any)?.customEPNames ?? null,
      logsJson: (pointsSummary as any)?.logs ?? null,
      removedPointsJson: (pointsSummary as any)?.removedPoints ?? null,
      completenessJson: (pointsSummary as any)?.completeness ?? null,
    },
    update: {
      pointsLength: liteStats.pointsLength,
      imagesLength: liteStats.imagesLength,
      themeJson: (pointsSummary as any)?.theme ?? null,
      customEpNamesJson: (pointsSummary as any)?.customEPNames ?? null,
      logsJson: (pointsSummary as any)?.logs ?? null,
      removedPointsJson: (pointsSummary as any)?.removedPoints ?? null,
      completenessJson: (pointsSummary as any)?.completeness ?? null,
    },
  })

  await deps.prisma.anitabiPoint.deleteMany({ where: { bangumiId: normalized.id } })

  if (points.length > 0) {
    await deps.prisma.anitabiPoint.createMany({
      data: points.map((point) => ({
        id: point.id,
        bangumiId: point.bangumiId,
        name: point.name,
        nameZh: point.nameZh,
        geoLat: point.geoLat,
        geoLng: point.geoLng,
        ep: point.ep,
        s: point.s,
        image: point.image,
        origin: point.origin,
        originUrl: point.originUrl,
        originLink: point.originLink,
        density: point.density,
        mark: point.mark,
        folder: point.folder,
        uid: point.uid,
        reviewUid: point.reviewUid,
        datasetVersion,
      })),
    })
  }

  return { changed: true, id: normalized.id }
}

async function syncContributorsAndChangelog(deps: AnitabiApiDeps, datasetVersion: string) {
  const siteBase = deps.getSiteBase()

  const [iconsSvg, changelogText, usersRaw] = await Promise.all([
    fetchTextWithRetry(`${siteBase}/api/bangumi/icons.svg`),
    fetchTextWithRetry(`${siteBase}/CHANGELOG.md`),
    fetchJsonWithRetry<unknown>(`${siteBase}/d/users.json`),
  ])

  if (iconsSvg != null) {
    await writeRawText(datasetVersion, 'icons.svg', iconsSvg)
    await upsertCursor(deps.prisma, 'iconsSvg', { value: iconsSvg })
  }

  if (changelogText != null) {
    await writeRawText(datasetVersion, 'CHANGELOG.md', changelogText)
    const sourceHash = hashText(changelogText)
    const entries = parseChangelogMarkdown(changelogText)

    await deps.prisma.anitabiChangelogEntry.deleteMany({})
    if (entries.length) {
      await deps.prisma.anitabiChangelogEntry.createMany({
        data: entries.map((entry) => ({
          date: entry.date || '',
          title: entry.title,
          body: entry.body,
          linksJson: entry.links,
          sourceHash,
        })),
      })
    }

    await upsertCursor(deps.prisma, 'changelog', { value: sourceHash })
  }

  if (usersRaw != null) {
    await writeRawJson(datasetVersion, 'users', usersRaw)
    const rows = normalizeContributorsFromUsersRaw(usersRaw)
    const dedup = new Map(rows.map((row) => [row.id, row]))

    await deps.prisma.anitabiContributor.deleteMany({})
    if (dedup.size > 0) {
      await deps.prisma.anitabiContributor.createMany({
        data: Array.from(dedup.values()).map((item) => ({
          id: item.id,
          name: item.name,
          avatar: item.avatar,
          link: item.link,
          raw: item.payload as any,
        })),
      })
    }

    await upsertCursor(deps.prisma, 'usersJson', { value: String(dedup.size) })
  }
}

export async function runAnitabiSync(
  deps: AnitabiApiDeps,
  input: { mode: AnitabiSyncMode }
): Promise<AnitabiSyncReport> {
  const startedAt = deps.now()
  const datasetVersion = nowVersion(startedAt)
  const dryRun = input.mode === 'dryRun'
  const normalizedMode: 'full' | 'delta' = input.mode === 'full' ? 'full' : 'delta'

  const run = await deps.prisma.anitabiSyncRun.create({
    data: {
      mode: input.mode,
      status: 'running',
      startedAt,
      datasetVersion,
    },
  })

  try {
    const apiBase = deps.getApiBase()
    const bangumi = (await fetchJsonWithRetry<RawBangumi[]>(`${apiBase}/bangumi`)) || []
    const snapshotHash = hashText(JSON.stringify(bangumi))

    await writeRawJson(datasetVersion, 'bangumi', bangumi)

    const existing = await deps.prisma.anitabiBangumi.findMany({
      select: { id: true, sourceModifiedMs: true },
    })
    const existingMap = new Map(existing.map((row) => [row.id, row.sourceModifiedMs]))

    const changedRows = bangumi.filter((row) => {
      const id = Number(row?.id)
      if (!Number.isFinite(id)) return false
      if (normalizedMode === 'full') return true

      const modified = Number(row?.modified)
      const prev = existingMap.get(id)
      if (!Number.isFinite(modified)) return true
      if (prev == null) return true
      return BigInt(modified) !== prev
    })

    await asyncPool(changedRows, getSyncConcurrency(), async (row) => {
      await syncBangumiOne(deps, datasetVersion, row, dryRun)
    })

    if (!dryRun) {
      await syncContributorsAndChangelog(deps, datasetVersion)
      await upsertCursor(deps.prisma, 'activeDatasetVersion', { value: datasetVersion })
      await upsertCursor(deps.prisma, 'bangumi', { value: String(bangumi.length) })
    }

    await deps.prisma.anitabiSyncRun.update({
      where: { id: run.id },
      data: {
        status: 'ok',
        endedAt: deps.now(),
        changedCount: changedRows.length,
        sourceSnapshotHash: snapshotHash,
      },
    })

    return {
      runId: run.id,
      mode: input.mode,
      status: 'ok',
      datasetVersion: dryRun ? null : datasetVersion,
      scanned: bangumi.length,
      changed: changedRows.length,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error'

    await deps.prisma.anitabiSyncRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        endedAt: deps.now(),
        errorSummary: message,
      },
    })

    return {
      runId: run.id,
      mode: input.mode,
      status: 'failed',
      datasetVersion: null,
      scanned: 0,
      changed: 0,
      message,
    }
  }
}
