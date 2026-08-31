import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import type { AnitabiSyncMode, AnitabiSyncReport } from '@/lib/anitabi/types'
import { hashText } from '@/lib/anitabi/utils'
import { HttpStatusError } from '@/lib/anitabi/source/client'
import { fetchBulkIndex, fetchBulkPage, getAnitabiBulkBase } from '@/lib/anitabi/source/bulkClient'
import {
  normalizeBulkBangumi,
  normalizePointsFromBulk,
  type BulkIndexEntry,
  type BulkPageEntry,
} from '@/lib/anitabi/source/bulkDecode'
import {
  getIncompleteRetryBackoffMs,
  getMaxPointDeletionRatio,
  getSyncMaxRuntimeMs,
  getSyncMinIntervalMs,
  isMirrorReconcileEnabled,
  nowVersion,
  upsertCursor,
} from '@/lib/anitabi/sync/workflow'
import {
  pruneMirrorRowsForDeletedPoints,
  reconcileMirrorAfterDiff,
} from '@/lib/anitabi/sync/mirrorReconcile'
import { enqueueMapTranslationTasksForBangumiIds } from '@/lib/translation/mapTaskEnqueue'

/**
 * Bulk 数据包同步管线。
 *
 * 与旧管线（workflow.ts，逐作品打 api.anitabi.cn，已被地理围栏 403 封死）的区别：
 *   - 上游请求从 ~N×2 次收敛为 1（索引）+ pageCount（约 7）次静态文件抓取；
 *   - 新作品发现回归（索引即全量清单）；
 *   - density/mark/folder/uid 与 themeJson 恢复供给（有值即写）；
 *   - reviewUid/originUrl/description 及其余 4 个 meta JSON 字段继续冻结。
 * 删除闸门、检查点滞后提交、defer 机制与旧管线同构 —— 那是四次自锁教训的结晶，
 * 任何"吞异常继续"的新分支都必须调用 defer()。
 */

const BULK_DATASET_CURSOR = 'bulkDatasetModified'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readDatasetCursor(deps: AnitabiApiDeps): Promise<number | null> {
  const row = await deps.prisma.anitabiSourceCursor.findUnique({
    where: { sourceName: BULK_DATASET_CURSOR },
  })
  const value = Number(row?.value)
  return Number.isFinite(value) && value > 0 ? value : null
}

type ApplyResult = { changed: boolean; deferred: boolean }

async function applyBulkBangumi(
  deps: AnitabiApiDeps,
  datasetVersion: string,
  entry: BulkIndexEntry,
  page: BulkPageEntry,
  dryRun: boolean,
): Promise<ApplyResult> {
  const deferredReasons: string[] = []
  const defer = (reason: string) => {
    deferredReasons.push(reason)
  }

  const normalized = normalizeBulkBangumi(entry, page.modified)
  const points = normalizePointsFromBulk(entry, page)

  // 完整性闸门：索引声明的点位 id 必须全部出现在分页里（B4：正常恒成立）。
  // 不成立说明页文件被截断或索引/分页版本错位 —— 保守处理，删除一律不做。
  const pageIdSet = new Set(page.points.map((p) => p.id))
  const missingFromPage = entry.points.filter((p) => !pageIdSet.has(p.id))
  const responseIsComplete = missingFromPage.length === 0
  if (!responseIsComplete) {
    defer(`bulk page missing ${missingFromPage.length} point(s) declared by index`)
  }

  if (dryRun) return { changed: true, deferred: !responseIsComplete }

  const mirrorReconcileEnabled = isMirrorReconcileEnabled()
  const existingBangumi = mirrorReconcileEnabled
    ? await deps.prisma.anitabiBangumi.findUnique({
        where: { id: normalized.id },
        select: { cover: true },
      })
    : null

  const normalizedPoints = points.map((point) => ({
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
    originLink: point.originLink,
    // 可再生回归的 4 个字段：仅上游确实给了值才带键（见 bulkDecode 的 undefined 语义）。
    // originUrl / reviewUid 无 bulk 来源，键永不出现 —— 冻结库内现值。
    ...(point.density !== undefined ? { density: point.density } : {}),
    ...(point.mark !== undefined ? { mark: point.mark } : {}),
    ...(point.folder !== undefined ? { folder: point.folder } : {}),
    ...(point.uid !== undefined ? { uid: point.uid } : {}),
    datasetVersion,
  }))

  const existingPointRows = await deps.prisma.anitabiPoint.findMany({
    where: { bangumiId: normalized.id },
    select: { id: true, image: true },
  })
  const existingPointIdSet = new Set(existingPointRows.map((row) => row.id))
  const existingPointImageMap = new Map(existingPointRows.map((row) => [row.id, row.image]))
  const incomingPointIdSet = new Set(normalizedPoints.map((point) => point.id))
  const staleCandidateIds = existingPointRows
    .map((row) => row.id)
    .filter((id) => !incomingPointIdSet.has(id))

  // 删除闸门与旧管线同构：完整性 + 比例双闸放行才删。
  const deletionRatio =
    existingPointRows.length > 0 ? staleCandidateIds.length / existingPointRows.length : 0
  const deletionRatioSafe = deletionRatio <= getMaxPointDeletionRatio()
  const deletionDeferred = staleCandidateIds.length > 0 && !(responseIsComplete && deletionRatioSafe)
  const stalePointIds = deletionDeferred ? [] : staleCandidateIds
  if (deletionDeferred) {
    defer(`${staleCandidateIds.length} stale point(s) not deleted (ratio ${(deletionRatio * 100).toFixed(1)}%)`)
    console.warn(
      `[anitabi/bulk] refusing to delete ${staleCandidateIds.length} point(s) for bangumi ${normalized.id}; `
        + `complete=${responseIsComplete} ratio=${(deletionRatio * 100).toFixed(1)}%; checkpoint held back`,
    )
  }

  // cat/tags 恢复供给：有值才写，空数组不写（不许清空既有 tags）。
  // description 无来源，update 不碰。cover/color/city 同旧管线：有值才写。
  const renewableBangumiFields = {
    titleZh: normalized.titleZh,
    titleJaRaw: normalized.titleJaRaw,
    ...(normalized.cover != null ? { cover: normalized.cover } : {}),
    ...(normalized.color != null ? { color: normalized.color } : {}),
    ...(normalized.city != null ? { city: normalized.city } : {}),
    ...(normalized.cat != null ? { cat: normalized.cat } : {}),
    ...(normalized.tags.length > 0 ? { tags: normalized.tags } : {}),
    ...(normalized.geoLat != null ? { geoLat: normalized.geoLat } : {}),
    ...(normalized.geoLng != null ? { geoLng: normalized.geoLng } : {}),
    ...(normalized.zoom != null ? { zoom: normalized.zoom } : {}),
    mapEnabled: true,
    datasetVersion,
  }

  await deps.prisma.anitabiBangumi.upsert({
    where: { id: normalized.id },
    create: { id: normalized.id, ...renewableBangumiFields, description: null },
    update: renewableBangumiFields,
  })

  // 计数改为实算（B4：分页即权威全集）。themeJson 恢复供给：形态与
  // components/map/types.ts 的 isValidTheme 兼容（B6），有 theme 才写。
  // 其余 4 个 meta JSON 字段无来源，继续冻结。
  const liteCounts = {
    pointsLength: normalizedPoints.length,
    imagesLength: normalizedPoints.filter((p) => p.image).length,
    ...(page.theme ? { themeJson: page.theme } : {}),
  }
  await deps.prisma.anitabiBangumiMeta.upsert({
    where: { bangumiId: normalized.id },
    create: { bangumiId: normalized.id, ...liteCounts },
    update: liteCounts,
  })

  const newPoints = normalizedPoints.filter((p) => !existingPointIdSet.has(p.id))
  const existingPoints = normalizedPoints.filter((p) => existingPointIdSet.has(p.id))

  if (newPoints.length > 0) {
    await deps.prisma.anitabiPoint.createMany({ data: newPoints })
  }
  // 逐条 update，不包事务（Prisma 5s 事务上限是 2026-06-08 最后一次 delta 的死因）。
  for (const point of existingPoints) {
    const { id, ...data } = point
    await deps.prisma.anitabiPoint.update({ where: { id }, data })
  }

  if (stalePointIds.length > 0) {
    if (mirrorReconcileEnabled) {
      try {
        await deps.prisma.$transaction(async (tx) => {
          await pruneMirrorRowsForDeletedPoints(tx, stalePointIds)
          await tx.anitabiPoint.deleteMany({ where: { id: { in: stalePointIds } } })
        })
      } catch (error) {
        defer('stale point deletion transaction failed')
        console.warn(`[anitabi/bulk] mirror cleanup failed for bangumi ${normalized.id}`, error)
      }
    } else {
      await deps.prisma.anitabiPoint.deleteMany({ where: { id: { in: stalePointIds } } })
    }
  }

  if (mirrorReconcileEnabled) {
    try {
      await reconcileMirrorAfterDiff(deps.prisma, {
        bangumiChanges: [{
          id: normalized.id,
          field: 'cover',
          oldValue: existingBangumi?.cover ?? null,
          newValue: normalized.cover,
        }],
        pointChanges: normalizedPoints.map((point) => ({
          id: point.id,
          field: 'image',
          oldValue: existingPointImageMap.get(point.id) ?? null,
          newValue: point.image,
        })),
      })
    } catch (error) {
      defer('mirror reconciliation failed')
      console.warn(`[anitabi/bulk] mirror reconciliation failed for bangumi ${normalized.id}`, error)
    }
  }

  // 检查点滞后提交（与旧管线同构）：deferredReasons 非空则回拨，且不推进 sourceModifiedMs。
  const syncConverged = deferredReasons.length === 0
  if (!syncConverged) {
    console.warn(
      `[anitabi/bulk] bangumi ${normalized.id} did not converge (${deferredReasons.join('; ')})`,
    )
  }
  await deps.prisma.anitabiBangumiMeta.update({
    where: { bangumiId: normalized.id },
    data: {
      lastCheckedAt: syncConverged
        ? deps.now()
        : new Date(deps.now().getTime() - getIncompleteRetryBackoffMs()),
    },
  })
  if (syncConverged) {
    await deps.prisma.anitabiBangumi.update({
      where: { id: normalized.id },
      data: { sourceModifiedMs: normalized.sourceModifiedMs },
    })
  }

  return { changed: true, deferred: !syncConverged }
}

export async function runAnitabiBulkSync(
  deps: AnitabiApiDeps,
  input: { mode: AnitabiSyncMode },
): Promise<AnitabiSyncReport> {
  const startedAt = deps.now()
  const datasetVersion = nowVersion(startedAt)
  const dryRun = input.mode === 'dryRun'
  const full = input.mode === 'full'

  const run = await deps.prisma.anitabiSyncRun.create({
    data: { mode: `bulk-${input.mode}`, status: 'running', startedAt, datasetVersion },
  })

  try {
    const base = getAnitabiBulkBase()
    const index = await fetchBulkIndex(base)
    const snapshotHash = hashText(JSON.stringify(index.entries.map((e) => e.id)))

    // 数据集级短路：索引 modified 未前进 → 1 个请求收工（delta/dryRun）。
    const cursor = await readDatasetCursor(deps)
    if (!full && cursor != null && cursor >= index.modified) {
      await deps.prisma.anitabiSyncRun.update({
        where: { id: run.id },
        data: { status: 'ok', endedAt: deps.now(), changedCount: 0, sourceSnapshotHash: snapshotHash },
      })
      return {
        runId: run.id, mode: input.mode, status: 'ok',
        datasetVersion: dryRun ? null : datasetVersion,
        scanned: 0, changed: 0, totalCandidates: index.entries.length, hasMore: false,
        message: `数据集未变化（modified=${index.modified}），本轮短路`,
      }
    }

    // 一次性取全库 sourceModifiedMs 与点位计数，页内跳过未变作品。
    const knownRows = await deps.prisma.anitabiBangumi.findMany({
      where: { id: { in: index.entries.map((e) => e.id) } },
      select: { id: true, sourceModifiedMs: true },
    })
    const knownById = new Map(knownRows.map((r) => [r.id, r.sourceModifiedMs]))
    const pointCounts = await deps.prisma.anitabiPoint.groupBy({
      by: ['bangumiId'],
      _count: { _all: true },
    })
    const pointCountMap = new Map(pointCounts.map((row) => [row.bangumiId, row._count._all]))
    const entryById = new Map(index.entries.map((e) => [e.id, e]))

    const maxRuntimeMs = getSyncMaxRuntimeMs()
    const deadlineAt = Date.now() + maxRuntimeMs
    const minIntervalMs = getSyncMinIntervalMs()

    let processedCount = 0
    let changedCount = 0
    let deferredCount = 0
    let stoppedByTimeBudget = false
    const changedBangumiIds = new Set<number>()
    let lastFetchAt = 0

    outer: for (let p = 0; p < index.pageCount; p++) {
      if (Date.now() >= deadlineAt) {
        stoppedByTimeBudget = true
        break
      }
      // 页文件之间保持礼貌间隔（静态文件也不例外 —— 上游对频率敏感）。
      const waitMs = minIntervalMs - (Date.now() - lastFetchAt)
      if (waitMs > 0) await sleep(waitMs)
      lastFetchAt = Date.now()

      const page = await fetchBulkPage(base, p)
      for (const entry of page) {
        if (Date.now() >= deadlineAt) {
          stoppedByTimeBudget = true
          break outer
        }
        const lite = entryById.get(entry.id)
        if (!lite) {
          // 分页出现索引没有的作品 → 版本错位，保守跳过并阻止游标推进。
          deferredCount += 1
          console.warn(`[anitabi/bulk] page ${p} has bangumi ${entry.id} absent from index; skipped`)
          continue
        }
        processedCount += 1

        const knownModified = knownById.get(entry.id)
        const importedPoints = pointCountMap.get(entry.id) ?? 0
        const needsBackfill = lite.points.length > 0 && importedPoints < lite.points.length
        const unchanged =
          !full
          && !needsBackfill
          && knownModified != null
          && BigInt(entry.modified) === knownModified
        if (unchanged) continue

        const result = await applyBulkBangumi(deps, datasetVersion, lite, entry, dryRun)
        if (result.changed) {
          changedCount += 1
          changedBangumiIds.add(entry.id)
        }
        if (result.deferred) deferredCount += 1
      }
    }

    let enqueueSummary: { enqueued: number; updated: number } | null = null
    if (!dryRun) {
      await upsertCursor(deps.prisma, 'activeDatasetVersion', { value: datasetVersion })
      // 游标只在全部页处理完且零 defer 时推进（D9）—— 否则下轮重拉整套文件重试。
      if (!stoppedByTimeBudget && deferredCount === 0) {
        await upsertCursor(deps.prisma, BULK_DATASET_CURSOR, { value: String(index.modified) })
      }
      const autoEnqueueEnabled =
        String(process.env.ANITABI_TRANSLATION_AUTO_ENQUEUE || '').trim() === '1'
      if (autoEnqueueEnabled && changedBangumiIds.size > 0) {
        try {
          enqueueSummary = await enqueueMapTranslationTasksForBangumiIds({
            prisma: deps.prisma,
            bangumiIds: Array.from(changedBangumiIds),
            targetLanguages: ['en', 'ja'],
            mode: 'all',
          })
        } catch (error) {
          console.error('[anitabi/bulk] failed to auto-enqueue map translation tasks', error)
        }
      }
    }

    const hasMore = stoppedByTimeBudget
    const messages = [
      hasMore
        ? `时间预算用尽，已处理 ${processedCount}/${index.entries.length} 个作品，游标未推进、下轮续跑`
        : undefined,
      deferredCount > 0
        ? `${deferredCount} 个作品本轮未收敛，数据集游标未推进，后续轮次自动重试`
        : undefined,
      enqueueSummary
        ? `地图翻译任务自动入队：新建 ${enqueueSummary.enqueued}，更新 ${enqueueSummary.updated}`
        : undefined,
    ].filter(Boolean)

    await deps.prisma.anitabiSyncRun.update({
      where: { id: run.id },
      data: {
        status: hasMore ? 'partial' : 'ok',
        endedAt: deps.now(),
        changedCount,
        sourceSnapshotHash: snapshotHash,
      },
    })

    return {
      runId: run.id, mode: input.mode, status: 'ok',
      datasetVersion: dryRun ? null : datasetVersion,
      scanned: processedCount, changed: changedCount,
      totalCandidates: index.entries.length, hasMore,
      ...(messages.length ? { message: messages.join('；') } : {}),
    }
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : 'Unknown bulk sync error'
    const message =
      error instanceof HttpStatusError && error.status === 403
        ? `bulk 通道返回 403（分发域被封或域名策略变化，尝试切换 ANITABI_BULK_BASE_URL）：${baseMessage}`
        : baseMessage
    await deps.prisma.anitabiSyncRun.update({
      where: { id: run.id },
      data: { status: 'failed', endedAt: deps.now(), errorSummary: message },
    })
    return {
      runId: run.id, mode: input.mode, status: 'failed', datasetVersion: null,
      scanned: 0, changed: 0, totalCandidates: 0, hasMore: false, message,
    }
  }
}
