import type { PrismaClient } from '@prisma/client'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import type { AnitabiSyncMode, AnitabiSyncReport } from '@/lib/anitabi/types'
import { hashText, resolveAnitabiAssetUrl } from '@/lib/anitabi/utils'
import { fetchJsonWithRetry, HttpStatusError } from '@/lib/anitabi/source/client'
import {
  getLiteStats,
  normalizeBangumiFromLite,
  normalizePoints,
  type RawLite,
  type RawPointDetail,
} from '@/lib/anitabi/source/normalize'
import {
  pruneMirrorRowsForDeletedPoints,
  reconcileMirrorAfterDiff,
} from '@/lib/anitabi/sync/mirrorReconcile'
import { enqueueMapTranslationTasksForBangumiIds } from '@/lib/translation/mapTaskEnqueue'

export function nowVersion(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getSyncConcurrency(): number {
  const raw = Number.parseInt(String(process.env.ANITABI_SYNC_CONCURRENCY || ''), 10)
  if (!Number.isFinite(raw)) return 1
  // 合规化：上限降到 2。上游维护者把请求频率与 IP Block 直接挂钩，
  // 同步现在是全局串行的，这个值仅作保留（见 runAnitabiSync 的 minInterval 节流）。
  return clampInt(raw, 1, 2)
}

/**
 * 相邻两次上游请求的最小间隔（毫秒）。
 * 官方对「人类访问频率」的要求没有给具体数字，起步取 1s/次，可用环境变量放宽或收紧。
 */
export function getSyncMinIntervalMs(): number {
  const raw = Number.parseInt(String(process.env.ANITABI_SYNC_MIN_INTERVAL_MS || ''), 10)
  if (!Number.isFinite(raw)) return 1000
  return clampInt(raw, 0, 60000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 单个作品单轮同步允许删除的点位比例上限。
 * 点位含不可再生字段，超过此比例视为上游响应异常而非真实删除，本轮跳过删除。
 * 0 表示完全禁止删除；1 表示不设限（回到旧行为，不建议）。
 */
export function getMaxPointDeletionRatio(): number {
  const raw = Number.parseFloat(String(process.env.ANITABI_SYNC_MAX_POINT_DELETION_RATIO || ''))
  if (!Number.isFinite(raw)) return 0.2
  return Math.max(0, Math.min(1, raw))
}

/**
 * 响应不完整时，lastCheckedAt 相对「现在」回拨的毫秒数。
 * 作用是让该作品排在正常作品之后、但仍靠前，下一轮能较快重试而不饿死其他作品。
 * 默认 6 小时：全量轮转一遍约需数小时，这个量级能保证「下一轮就重试」。
 */
export function getIncompleteRetryBackoffMs(): number {
  const raw = Number.parseInt(String(process.env.ANITABI_SYNC_INCOMPLETE_RETRY_BACKOFF_MS || ''), 10)
  if (!Number.isFinite(raw)) return 6 * 60 * 60 * 1000
  return clampInt(raw, 0, 30 * 24 * 60 * 60 * 1000)
}

function getSyncMaxRowsPerRun(overrideValue?: number | null): number | null {
  if (typeof overrideValue === 'number' && Number.isFinite(overrideValue)) {
    return clampInt(overrideValue, 1, 10000)
  }
  const raw = Number.parseInt(String(process.env.ANITABI_SYNC_MAX_ROWS_PER_RUN || ''), 10)
  if (!Number.isFinite(raw)) return null
  return clampInt(raw, 1, 10000)
}

export function getSyncMaxRuntimeMs(): number {
  const raw = Number.parseInt(String(process.env.ANITABI_SYNC_MAX_RUNTIME_MS || ''), 10)
  if (Number.isFinite(raw)) return clampInt(raw, 1000, 120000)
  if (process.env.VERCEL === '1') return 7000
  return 20000
}

export function isMirrorReconcileEnabled(): boolean {
  return String(process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED || '').trim() === '1'
}

export async function upsertCursor(
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

/**
 * 同步单个作品。
 *
 * 端点收敛（合规化）：只请求官方文档收录的两个端点 ——
 *   GET /bangumi/{id}/lite            作品元数据 + 变更判定
 *   GET /bangumi/{id}/points/detail   点位明细
 * 原先还打过 /bangumi、/bangumi/{id}、/bangumi/{id}/points 三个未收录端点，
 * 以及 3 个主域抓取。上游维护者已说明「请求授权范围之外的地址」正是
 * Cloudflare 403 IP Block 的成因，因此全部移除。
 *
 * 返回 changed=false 表示该作品 modified 未变、跳过了 points/detail 请求。
 */
async function syncBangumiOne(
  deps: AnitabiApiDeps,
  datasetVersion: string,
  candidate: { id: number; sourceModifiedMs: bigint | null; needsBackfill: boolean },
  dryRun: boolean,
  force: boolean
): Promise<{ changed: boolean; id: number; skipped?: boolean; deferred?: boolean }> {
  const apiBase = deps.getApiBase()

  /**
   * 本轮未完成的工作清单 —— 决定同步检查点能否推进。
   *
   * 为什么用累积清单而不是几个布尔量：本函数里每个 `catch` 都是「记录警告后继续」
   * （作品其余部分已同步成功，不该整体判失败），而每一个这样的 catch 都是检查点
   * 被过早推进的入口。历史上已经因此四次出现自锁 —— 残缺响应、比例拒删、
   * 删除事务失败、镜像对账失败，每次都是新加的分支绕过了上一次的补丁。
   *
   * 约定：**任何吞掉异常或跳过预期工作的分支，都必须调用 defer()**。
   * 只要清单非空，检查点就保持在过去，下一轮自动重试。
   */
  const deferredReasons: string[] = []
  const defer = (reason: string) => {
    deferredReasons.push(reason)
  }

  const lite = await fetchJsonWithRetry<RawLite>(`${apiBase}/bangumi/${candidate.id}/lite`, { allow404: true })
  const mapEnabled = Boolean(lite)

  // /lite 的 404 表示该作品无巡礼数据。记录核对时间后跳过，避免反复请求。
  if (!lite) {
    if (!dryRun) {
      await touchMetaCheckedAt(deps, candidate.id, deps.now())
    }
    return { changed: false, id: candidate.id, skipped: true }
  }

  const normalized = normalizeBangumiFromLite({ ...lite, id: lite.id ?? candidate.id })

  // modified 未变且点位数量完整 → 无需再请求 points/detail，省一次上游请求。
  const upstreamModified = normalized.sourceModifiedMs
  const unchanged =
    !force
    && !candidate.needsBackfill
    && upstreamModified != null
    && candidate.sourceModifiedMs != null
    && upstreamModified === candidate.sourceModifiedMs

  if (unchanged) {
    if (!dryRun) {
      await touchMetaCheckedAt(deps, candidate.id, deps.now())
    }
    return { changed: false, id: candidate.id }
  }

  const pointsDetail =
    (await fetchJsonWithRetry<RawPointDetail[]>(`${apiBase}/bangumi/${candidate.id}/points/detail`)) || []

  // 摘要端点（/bangumi/{id}/points）已停用，故不再传 summary。
  // normalizePoints 在无 summary 时不产出 density/mark/folder/uid/reviewUid 这几个键，
  // 下面的 upsert 会整个跳过它们 —— 那些是不可再生数据，绝不能覆盖成 null。
  const points = normalizePoints(candidate.id, pointsDetail, null)
  const liteStats = getLiteStats(lite)
  const resolvedCover = resolveAnitabiAssetUrl(normalized.cover)

  /**
   * 本轮上游响应是否完整。
   * 判据：上游必须明确声明 pointsLength，且实际返回的点位数不少于它。
   * 字段缺失（null）同样算不完整：无从判断就必须保守。
   */
  const responseIsComplete =
    liteStats.pointsLength != null && points.length >= liteStats.pointsLength

  const mirrorReconcileEnabled = !dryRun && isMirrorReconcileEnabled()
  const existingBangumi = mirrorReconcileEnabled
    ? await deps.prisma.anitabiBangumi.findUnique({
        where: { id: normalized.id },
        select: { cover: true },
      })
    : null

  if (dryRun) {
    return { changed: true, id: candidate.id }
  }

  const normalizedPoints = points.map((point) => ({
    id: point.id,
    bangumiId: point.bangumiId,
    name: point.name,
    nameZh: point.nameZh,
    geoLat: point.geoLat,
    geoLng: point.geoLng,
    ep: point.ep,
    s: point.s,
    image: resolveAnitabiAssetUrl(point.image),
    origin: point.origin,
    originUrl: resolveAnitabiAssetUrl(point.originUrl),
    originLink: resolveAnitabiAssetUrl(point.originLink),
    // 仅当上游确实给了值时才带上这几个键（见 normalizePoints 的说明）。
    ...(point.density !== undefined ? { density: point.density } : {}),
    ...(point.mark !== undefined ? { mark: point.mark } : {}),
    ...(point.folder !== undefined ? { folder: point.folder } : {}),
    ...(point.uid !== undefined ? { uid: point.uid } : {}),
    ...(point.reviewUid !== undefined ? { reviewUid: point.reviewUid } : {}),
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

  /**
   * 删除闸门。点位行携带 density/mark/folder/uid/reviewUid 这些**不可再生**字段
   * （原摘要端点已停用，删掉就再也取不回来），所以「上游没返回」不足以作为删除依据 ——
   * 一次不完整的响应（限流截断、部分失败、临时故障）会造成永久损失。
   *
   * 两道闸门都放行才执行删除：
   *   - responseIsComplete：上游明确声明 pointsLength 且返回数不少于它
   *   - deletionRatioSafe：待删比例不超过上限
   * 宁可留下几条陈旧点位，也不能误删不可再生数据。
   */
  const upstreamClaimedCount = liteStats.pointsLength
  const returnedCount = normalizedPoints.length
  const deletionRatio =
    existingPointRows.length > 0 ? staleCandidateIds.length / existingPointRows.length : 0
  const deletionRatioSafe = deletionRatio <= getMaxPointDeletionRatio()
  const deletionDeferred = staleCandidateIds.length > 0 && !(responseIsComplete && deletionRatioSafe)
  const stalePointIds = deletionDeferred ? [] : staleCandidateIds

  if (!responseIsComplete) {
    defer(
      `upstream response incomplete (returned ${returnedCount}, claims ${upstreamClaimedCount ?? 'unknown'})`,
    )
  }

  if (deletionDeferred) {
    defer(`${staleCandidateIds.length} stale point(s) not deleted (ratio ${(deletionRatio * 100).toFixed(1)}%)`)
    console.warn(
      `[anitabi/sync] refusing to delete ${staleCandidateIds.length} point(s) for bangumi ${normalized.id}: `
        + `upstream returned ${returnedCount} point(s) but claims `
        + `${upstreamClaimedCount ?? 'unknown (field absent)'}; `
        + `deletion ratio ${(deletionRatio * 100).toFixed(1)}%. `
        + `Points carry non-renewable fields, so an incomplete response must not trigger deletion. `
        + `Checkpoint is held back so the next round retries this work.`,
    )
  }

  // cat / description / tags 不在 /lite 里，没有上游来源 —— 只在 create 时给默认值，
  // update 完全不碰，否则会把库里已有的值抹掉。
  //
  // cover / color / city 虽然 /lite 会给，但响应不完整时会缺字段并被归一成 null。
  // 它们同样只在上游确实给了值时才更新 —— 宁可留旧值，也不要因一次异常响应
  // 把封面和主题色抹空（那会直接影响地图渲染）。
  const optionalTextFields = {
    ...(resolvedCover != null ? { cover: resolvedCover } : {}),
    ...(normalized.color != null ? { color: normalized.color } : {}),
    ...(normalized.city != null ? { city: normalized.city } : {}),
  }

  // 标题与坐标是 /lite 的核心字段，缺失即视为响应异常（上方 titleZh 已有 `#${id}` 兜底）。
  //
  // 注意这里**不写 sourceModifiedMs** —— 它是同步检查点，必须等点位写入与删除
  // 全部有结果之后才能决定推进与否（见本函数末尾的 commitCheckpoint）。
  const renewableBangumiFields = {
    titleZh: normalized.titleZh,
    titleJaRaw: normalized.titleJaRaw,
    ...optionalTextFields,
    ...(normalized.geoLat != null ? { geoLat: normalized.geoLat } : {}),
    ...(normalized.geoLng != null ? { geoLng: normalized.geoLng } : {}),
    ...(normalized.zoom != null ? { zoom: normalized.zoom } : {}),
    mapEnabled,
    datasetVersion,
  }

  await deps.prisma.anitabiBangumi.upsert({
    where: { id: normalized.id },
    create: {
      id: normalized.id,
      ...renewableBangumiFields,
      cat: null,
      description: null,
      tags: [],
    },
    update: renewableBangumiFields,
  })

  // 5 个 JSON 字段来自已停用的摘要端点，是不可再生资源：
  // create 时给 null（新作品本来就没有），update 时完全不写。
  // pointsLength/imagesLength 同样只在上游确实给了数值时才写 ——
  // /lite 缺这两个字段时 getLiteStats 返回 null，写 0 会把真实计数抹掉，
  // 而前端与删除闸门都依赖它判断数据完整度。
  const liteCounts = {
    ...(liteStats.pointsLength != null ? { pointsLength: liteStats.pointsLength } : {}),
    ...(liteStats.imagesLength != null ? { imagesLength: liteStats.imagesLength } : {}),
  }

  // 计数可以立即写（它们只是上游自报的元数据）；
  // 检查点必须等所有点位写入与删除都有结果之后才写，见本函数末尾。
  await deps.prisma.anitabiBangumiMeta.upsert({
    where: { bangumiId: normalized.id },
    create: { bangumiId: normalized.id, ...liteCounts },
    update: liteCounts,
  })

  const newPoints = normalizedPoints.filter((p) => !existingPointIdSet.has(p.id))
  const existingPoints = normalizedPoints.filter((p) => existingPointIdSet.has(p.id))

  // Batch insert new points
  if (newPoints.length > 0) {
    await deps.prisma.anitabiPoint.createMany({ data: newPoints })
  }

  // Batch update existing points.
  // 原先是每 50 条包一个 $transaction —— 那是 2026-06-08 最后一次 delta 的直接死因
  // （Prisma 默认事务上限 5000ms，实耗 5580ms，报 "rollback cannot be executed on an
  // expired transaction"）。这些更新彼此独立、不需要原子性，逐条执行即可；
  // 单条失败只影响该点位，且会被外层 catch 记入 errorSummary。
  for (const point of existingPoints) {
    const { id, ...data } = point
    await deps.prisma.anitabiPoint.update({ where: { id }, data })
  }

  if (stalePointIds.length > 0) {
    if (mirrorReconcileEnabled) {
      try {
        await deps.prisma.$transaction(async (tx) => {
          await pruneMirrorRowsForDeletedPoints(tx, stalePointIds)
          await tx.anitabiPoint.deleteMany({
            where: {
              id: { in: stalePointIds },
            },
          })
        })
      } catch (error) {
        // 不上抛：作品其余部分已同步成功，不该整体判失败。
        // 但要登记未完成，让检查点保持在过去、下一轮重试。
        defer('stale point deletion transaction failed')
        console.warn(
          `[anitabi/sync] mirror cleanup failed for deleted points in bangumi ${normalized.id}; `
            + `checkpoint held back so the next round retries`,
          error,
        )
      }
    } else {
      await deps.prisma.anitabiPoint.deleteMany({
        where: {
          id: { in: stalePointIds },
        },
      })
    }
  }

  if (mirrorReconcileEnabled) {
    const bangumiChanges = [
      {
        id: normalized.id,
        field: 'cover',
        oldValue: existingBangumi?.cover ?? null,
        newValue: resolvedCover,
      },
    ]
    const pointChanges = normalizedPoints.map((point) => ({
      id: point.id,
      field: 'image',
      oldValue: existingPointImageMap.get(point.id) ?? null,
      newValue: point.image,
    }))

    try {
      await reconcileMirrorAfterDiff(deps.prisma, {
        bangumiChanges,
        pointChanges,
      })
    } catch (error) {
      // 镜像对账负责把换了 URL 的图片标记为待重新镜像。失败意味着 R2 里仍是旧图，
      // 而 cover/image 字段已经指向新 URL —— 图文不一致，本轮没有真正同步完。
      // 若推进检查点，下一轮 unchanged 会跳过，这批镜像永远不会被修正。
      defer('mirror reconciliation failed')
      console.warn(
        `[anitabi/sync] mirror reconciliation failed for bangumi ${normalized.id}; `
          + `checkpoint held back so the next round retries`,
        error,
      )
    }
  }

  /**
   * 提交同步检查点 —— 必须放在所有写操作**之后**，并且以 deferredReasons 为唯一依据。
   *
   * 收敛 == 本轮没有任何登记在案的未完成工作。目前会登记的有：
   *   - 上游响应残缺
   *   - 陈旧点位被安全闸门拦下未删
   *   - 删除事务抛错
   *   - 镜像对账失败
   * 后续若新增任何「吞异常继续」的分支，同样必须调用 defer()，否则会重新引入自锁。
   *
   * 未收敛时 lastCheckedAt 回拨一个退避量：既保证下一轮优先重试，
   * 又不会把该作品钉死在队首饿死其余数千个作品。
   */
  const syncConverged = deferredReasons.length === 0
  const retryBackoffMs = getIncompleteRetryBackoffMs()

  if (!syncConverged) {
    console.warn(
      `[anitabi/sync] bangumi ${normalized.id} did not converge this round `
        + `(${deferredReasons.join('; ')}); checkpoint held back for retry`,
    )
  }

  await deps.prisma.anitabiBangumiMeta.update({
    where: { bangumiId: normalized.id },
    data: {
      lastCheckedAt: syncConverged
        ? deps.now()
        : new Date(deps.now().getTime() - retryBackoffMs),
    },
  })

  if (syncConverged && normalized.sourceModifiedMs != null) {
    await deps.prisma.anitabiBangumi.update({
      where: { id: normalized.id },
      data: { sourceModifiedMs: normalized.sourceModifiedMs },
    })
  }

  return { changed: true, id: normalized.id, deferred: !syncConverged }
}

/**
 * 记录「已向上游核对过」的时间，即使本次没有变更。
 * 枚举层按 lastCheckedAt 最旧优先轮转，不写的话同一批作品会被反复选中。
 */
async function touchMetaCheckedAt(deps: AnitabiApiDeps, bangumiId: number, at: Date): Promise<void> {
  await deps.prisma.anitabiBangumiMeta.upsert({
    where: { bangumiId },
    create: { bangumiId, lastCheckedAt: at },
    update: { lastCheckedAt: at },
  })
}

// syncContributorsAndChangelog() 已移除。
// 它抓取 {siteBase}/api/bangumi/icons.svg、/CHANGELOG.md、/d/users.json 三个主域地址，
// 而官方 api.md 明文要求「请勿在任何场景下请求主域」。上游维护者也确认请求授权范围
// 之外的地址正是 Cloudflare 403 IP Block 的成因。此外 www.anitabi.cn 已 NXDOMAIN，
// 这三个请求各要走满 4 次重试（1+3+8 秒），合计约 14 秒 —— 而默认时间预算只有 20 秒。
// AnitabiChangelogEntry / AnitabiContributor 表保留现有数据，只是不再更新。

export async function runAnitabiSync(
  deps: AnitabiApiDeps,
  input: { mode: AnitabiSyncMode; maxRowsPerRun?: number | null }
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
    // 枚举层：官方 API 没有「列出全部作品」的入口（原先用的 GET /bangumi 未被文档收录，
    // 且已被上游关闭），因此候选集只能来自我们自己的库，按 lastCheckedAt 最旧优先轮转。
    // full 模式取全部；delta 模式同样轮转，但会用 /lite 的 modified 做二次过滤。
    const maxRowsPerRun = getSyncMaxRowsPerRun(input.maxRowsPerRun)

    const pointCounts = await deps.prisma.anitabiPoint.groupBy({
      by: ['bangumiId'],
      _count: { _all: true },
    })
    const pointCountMap = new Map(pointCounts.map((row) => [row.bangumiId, row._count._all]))

    const known = await deps.prisma.anitabiBangumi.findMany({
      // id <= 0 不是有效的 Bangumi subject ID。库里确实存在这种脏数据
      // （id=0 / titleZh='#0'，来自 2026-02 旧同步 normalizeBangumi 的兜底值），
      // 而它排在轮转队首，会让每轮开头就对上游发无效请求 ——
      // 这正是要避免的行为：无效请求同样计入 IP 信誉。
      where: { id: { gt: 0 } },
      select: {
        id: true,
        sourceModifiedMs: true,
        meta: { select: { pointsLength: true, lastCheckedAt: true } },
      },
      // 没核对过的排最前（nulls first），其余按最旧优先。
      orderBy: [{ meta: { lastCheckedAt: { sort: 'asc', nulls: 'first' } } }, { id: 'asc' }],
      ...(maxRowsPerRun ? { take: maxRowsPerRun } : {}),
    })

    const candidates = known.map((row) => {
      const expectedPoints = Number(row.meta?.pointsLength || 0)
      const importedPoints = Number(pointCountMap.get(row.id) || 0)
      return {
        id: row.id,
        sourceModifiedMs: row.sourceModifiedMs,
        // 点位数不足说明上次没导完，即使 modified 未变也要重取。
        needsBackfill: expectedPoints > 0 && importedPoints < expectedPoints,
      }
    })

    // 快照哈希改为对候选 ID 集合求值 —— 原先是对 /bangumi 的全量响应体求值，该端点已停用。
    const snapshotHash = hashText(JSON.stringify(candidates.map((c) => c.id)))

    const maxRuntimeMs = getSyncMaxRuntimeMs()
    const deadlineAt = Date.now() + maxRuntimeMs
    const queue = candidates.slice()
    let processedCount = 0
    let changedCount = 0
    // 未收敛的作品数：响应残缺或删除被闸门拦下。它们的检查点被刻意留在过去，
    // 会在后续轮次自动重试 —— 计数出来是为了让这批工作在报告里可见，而非静默堆积。
    let deferredCount = 0
    let stoppedByTimeBudget = false
    const processedBangumiIds = new Set<number>()

    // 合规化要求「人类访问频率」：全局串行 + 固定最小间隔。
    // 上游维护者明确把频率与 IP Block 挂钩，这里不再并发。
    const minIntervalMs = getSyncMinIntervalMs()
    let lastRequestAt = 0

    while (true) {
      if (Date.now() >= deadlineAt) {
        stoppedByTimeBudget = true
        break
      }
      const candidate = queue.shift()
      if (!candidate) break

      const waitMs = minIntervalMs - (Date.now() - lastRequestAt)
      if (waitMs > 0) {
        // 让出时间也要遵守预算，否则会超出 maxRuntimeMs。
        if (Date.now() + waitMs >= deadlineAt) {
          queue.unshift(candidate)
          stoppedByTimeBudget = true
          break
        }
        await sleep(waitMs)
      }
      lastRequestAt = Date.now()

      const result = await syncBangumiOne(
        deps,
        datasetVersion,
        candidate,
        dryRun,
        normalizedMode === 'full'
      )
      processedBangumiIds.add(result.id)
      processedCount += 1
      if (result.changed) changedCount += 1
      if (result.deferred) deferredCount += 1
    }

    let enqueueSummary:
      | {
          scannedBangumi: number
          scannedPoint: number
          enqueued: number
          updated: number
        }
      | null = null

    if (!dryRun) {
      // syncContributorsAndChangelog() 已移除（主域抓取违反官方约定，见上方说明）。
      await upsertCursor(deps.prisma, 'activeDatasetVersion', { value: datasetVersion })
      await upsertCursor(deps.prisma, 'bangumi', { value: String(candidates.length) })

      const autoEnqueueEnabled = String(process.env.ANITABI_TRANSLATION_AUTO_ENQUEUE || '').trim() === '1'
      if (autoEnqueueEnabled && processedBangumiIds.size > 0) {
        try {
          enqueueSummary = await enqueueMapTranslationTasksForBangumiIds({
            prisma: deps.prisma,
            bangumiIds: Array.from(processedBangumiIds),
            targetLanguages: ['en', 'ja'],
            mode: 'all',
          })
        } catch (error) {
          console.error('[anitabi/sync] failed to auto-enqueue map translation tasks', error)
        }
      }
    }

    const progressMessage =
      stoppedByTimeBudget && queue.length > 0
        ? `单次执行已到时间预算，已核对 ${processedCount}/${candidates.length} 个作品，请继续推进下一批`
        : undefined
    const enqueueMessage = enqueueSummary
      ? `地图翻译任务自动入队：新建 ${enqueueSummary.enqueued}，更新 ${enqueueSummary.updated}`
      : undefined
    const deferredMessage =
      deferredCount > 0
        ? `${deferredCount} 个作品本轮未收敛（上游响应残缺或删除被安全闸门拦下），检查点未推进，后续轮次会自动重试`
        : undefined
    const message =
      [progressMessage, deferredMessage, enqueueMessage].filter(Boolean).join('；') || undefined

    const hasMore = stoppedByTimeBudget && queue.length > 0

    await deps.prisma.anitabiSyncRun.update({
      where: { id: run.id },
      data: {
        status: hasMore ? 'partial' : 'ok',
        endedAt: deps.now(),
        changedCount: changedCount,
        sourceSnapshotHash: snapshotHash,
      },
    })

    return {
      runId: run.id,
      mode: input.mode,
      status: 'ok',
      datasetVersion: dryRun ? null : datasetVersion,
      scanned: processedCount,
      changed: changedCount,
      totalCandidates: candidates.length,
      hasMore,
      ...(message ? { message } : {}),
    }
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : 'Unknown sync error'
    // 403 是合规性信号，必须显式落库而不是混在通用错误里 ——
    // 上游把它用于「请求了授权范围之外的地址」或频率超限的 IP Block。
    const message =
      error instanceof HttpStatusError && error.status === 403
        ? `上游返回 403（IP 可能被 Cloudflare 拦截：检查是否请求了未授权端点或频率过高）：${baseMessage}`
        : baseMessage

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
      totalCandidates: 0,
      hasMore: false,
      message,
    }
  }
}
