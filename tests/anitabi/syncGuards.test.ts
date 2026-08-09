import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'

const mocks = {
  fetchJsonWithRetry: vi.fn(),
  fetchTextWithRetry: vi.fn(),
  enqueueMapTranslationTasksForBangumiIds: vi.fn(),
}

vi.mock('@/lib/anitabi/source/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/anitabi/source/client')>()
  return {
    HttpStatusError: actual.HttpStatusError,
    fetchJsonWithRetry: mocks.fetchJsonWithRetry,
    fetchTextWithRetry: mocks.fetchTextWithRetry,
  }
})

vi.mock('@/lib/translation/mapTaskEnqueue', () => ({
  enqueueMapTranslationTasksForBangumiIds: mocks.enqueueMapTranslationTasksForBangumiIds,
}))

/** 库里已有 N 个点位，携带不可再生字段。 */
function makeExistingPoints(bangumiId: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${bangumiId}:p${i}`,
    image: `https://image.anitabi.cn/points/${bangumiId}/p${i}.jpg`,
  }))
}

function createDeps(input: {
  existingPointRows: Array<{ id: string; image: string | null }>
  pointsLength: number
}): AnitabiApiDeps & { __calls: { deleteMany: ReturnType<typeof vi.fn> } } {
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 })
  const deps = {
    prisma: {
      anitabiSyncRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      anitabiBangumi: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, sourceModifiedMs: BigInt(1), meta: { pointsLength: input.pointsLength, lastCheckedAt: null } },
        ]),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
        // sourceModifiedMs 同样延后到收敛确认后才单独 update。
        update: vi.fn().mockResolvedValue({}),
      },
      anitabiBangumiMeta: {
        upsert: vi.fn().mockResolvedValue({}),
        // 检查点（lastCheckedAt）在所有点位写入/删除完成后才单独 update 提交。
        update: vi.fn().mockResolvedValue({}),
      },
      anitabiPoint: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue(input.existingPointRows),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({}),
        deleteMany,
      },
      anitabiSourceCursor: { upsert: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn().mockImplementation(async (i: unknown) =>
        typeof i === 'function' ? (i as (tx: unknown) => unknown)({}) : i,
      ),
    } as unknown as AnitabiApiDeps['prisma'],
    getSession: async () => null,
    now: () => new Date('2026-08-09T00:00:00.000Z'),
    getCronSecret: () => '',
    getApiBase: () => 'https://api.anitabi.cn',
    getSiteBase: () => '',
  } as unknown as AnitabiApiDeps
  return Object.assign(deps, { __calls: { deleteMany } })
}

/** 读取最终提交的检查点（在所有写操作完成后由单独的 update 写入）。 */
function readCheckpoint(deps: AnitabiApiDeps): {
  lastCheckedAt: Date | undefined
  sourceModifiedMsAdvanced: boolean
} {
  const metaUpdate = (deps.prisma.anitabiBangumiMeta.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
  const bangumiUpdate = (deps.prisma.anitabiBangumi.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
  return {
    lastCheckedAt: metaUpdate?.data?.lastCheckedAt as Date | undefined,
    sourceModifiedMsAdvanced: bangumiUpdate?.data?.sourceModifiedMs != null,
  }
}

/** 上游返回 `returned` 个点位，并在 /lite 里声称共有 `claims` 个。 */
function mockUpstream(returned: number, claims: number) {
  mocks.fetchJsonWithRetry
    .mockResolvedValueOnce({
      id: 1,
      cn: 'Work',
      title: 'Work',
      modified: 999,
      pointsLength: claims,
      imagesLength: claims,
    })
    .mockResolvedValueOnce(
      Array.from({ length: returned }, (_, i) => ({
        id: `p${i}`,
        name: `Point ${i}`,
        geo: [35, 139],
      })),
    )
}

describe('sync point deletion guard', () => {
  const originalInterval = process.env.ANITABI_SYNC_MIN_INTERVAL_MS
  const originalRatio = process.env.ANITABI_SYNC_MAX_POINT_DELETION_RATIO

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.enqueueMapTranslationTasksForBangumiIds.mockResolvedValue(null)
    process.env.ANITABI_SYNC_MIN_INTERVAL_MS = '0'
    delete process.env.ANITABI_SYNC_MAX_POINT_DELETION_RATIO
  })

  afterEach(() => {
    if (originalInterval == null) delete process.env.ANITABI_SYNC_MIN_INTERVAL_MS
    else process.env.ANITABI_SYNC_MIN_INTERVAL_MS = originalInterval
    if (originalRatio == null) delete process.env.ANITABI_SYNC_MAX_POINT_DELETION_RATIO
    else process.env.ANITABI_SYNC_MAX_POINT_DELETION_RATIO = originalRatio
  })

  it('refuses to delete points when the upstream response is drastically incomplete', async () => {
    // 沙箱实测捕获的真实缺陷：上游只返回 2 个点位，库里有 194 个。
    // 若按「上游没返回就是已删除」处理，192 行连同其不可再生字段会被永久删除。
    const deps = createDeps({ existingPointRows: makeExistingPoints(1, 194), pointsLength: 2 })
    mockUpstream(2, 2)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'full' })

    expect(report.status).toBe('ok')
    expect(deps.__calls.deleteMany).not.toHaveBeenCalled()
    // 194 个已有点位中 p0/p1 与上游返回的 ID 重合，其余 192 个本会被误删。
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('refusing to delete 192 point(s)'))
    warn.mockRestore()
  })

  it('allows deletion when the response is complete and the removed share is small', async () => {
    // 上游返回 19 个且声称 19 个，库里 20 个 → 删 1 个（5%）在阈值内，属正常删除。
    const deps = createDeps({ existingPointRows: makeExistingPoints(1, 20), pointsLength: 19 })
    mockUpstream(19, 19)

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'full' })

    expect(report.status).toBe('ok')
    expect(deps.__calls.deleteMany).toHaveBeenCalledTimes(1)
  })

  it('refuses deletion when the removed share exceeds the ratio cap even if counts agree', async () => {
    // 计数自洽（返回 5、声称 5）但要删掉库里 20 个中的 15 个（75%）——
    // 超过 20% 上限，视为异常，拒绝删除。
    const deps = createDeps({ existingPointRows: makeExistingPoints(1, 20), pointsLength: 5 })
    mockUpstream(5, 5)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    expect(deps.__calls.deleteMany).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('honours ANITABI_SYNC_MAX_POINT_DELETION_RATIO=1 as an explicit opt-out', async () => {
    process.env.ANITABI_SYNC_MAX_POINT_DELETION_RATIO = '1'
    const deps = createDeps({ existingPointRows: makeExistingPoints(1, 20), pointsLength: 5 })
    mockUpstream(5, 5)

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    expect(deps.__calls.deleteMany).toHaveBeenCalledTimes(1)
  })

  it('refuses deletion when /lite omits pointsLength entirely', async () => {
    // 字段缺失时无从判断响应是否完整 —— 必须保守，绝不能当作「上游声称 0 个点位」。
    const deps = createDeps({ existingPointRows: makeExistingPoints(1, 20), pointsLength: 20 })
    mocks.fetchJsonWithRetry
      .mockResolvedValueOnce({ id: 1, cn: 'W', title: 'W', modified: 999 }) // 无 pointsLength
      .mockResolvedValueOnce([{ id: 'p0', name: 'P0', geo: [35, 139] }])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    expect(deps.__calls.deleteMany).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown (field absent)'))
    warn.mockRestore()
  })
})

describe('sync field-preservation guards', () => {
  const originalInterval = process.env.ANITABI_SYNC_MIN_INTERVAL_MS

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.enqueueMapTranslationTasksForBangumiIds.mockResolvedValue(null)
    process.env.ANITABI_SYNC_MIN_INTERVAL_MS = '0'
  })

  afterEach(() => {
    if (originalInterval == null) delete process.env.ANITABI_SYNC_MIN_INTERVAL_MS
    else process.env.ANITABI_SYNC_MIN_INTERVAL_MS = originalInterval
  })

  it('does not overwrite pointsLength/imagesLength when /lite omits them', async () => {
    // 写 0 会抹掉真实计数，而前端完整度显示与删除闸门都依赖它。
    const deps = createDeps({ existingPointRows: [], pointsLength: 100 })
    mocks.fetchJsonWithRetry
      .mockResolvedValueOnce({ id: 1, cn: 'W', title: 'W', modified: 999 })
      .mockResolvedValueOnce([])

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    const metaUpsert = (deps.prisma.anitabiBangumiMeta.upsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(metaUpsert.update).not.toHaveProperty('pointsLength')
    expect(metaUpsert.update).not.toHaveProperty('imagesLength')
    // 检查点不在这个 upsert 里 —— 它延后到所有写操作完成后单独提交。
    expect(metaUpsert.update).not.toHaveProperty('lastCheckedAt')
    expect(readCheckpoint(deps).lastCheckedAt).toBeInstanceOf(Date)
  })

  it('does not overwrite cover/color/city when /lite omits them', async () => {
    // 一次异常响应不应把封面和主题色抹空 —— 那会直接影响地图渲染。
    const deps = createDeps({ existingPointRows: [], pointsLength: 1 })
    mocks.fetchJsonWithRetry
      .mockResolvedValueOnce({ id: 1, cn: 'W', title: 'W', modified: 999, pointsLength: 1 })
      .mockResolvedValueOnce([{ id: 'p0', name: 'P0', geo: [35, 139] }])

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    const update = (deps.prisma.anitabiBangumi.upsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.update
    expect(update).not.toHaveProperty('cover')
    expect(update).not.toHaveProperty('color')
    expect(update).not.toHaveProperty('city')
    // 标题始终有兜底值，正常写入。
    expect(update).toHaveProperty('titleZh')
  })

  it('never writes cat/description/tags on update (no upstream source)', async () => {
    const deps = createDeps({ existingPointRows: [], pointsLength: 1 })
    mockUpstream(1, 1)

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    const update = (deps.prisma.anitabiBangumi.upsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.update
    expect(update).not.toHaveProperty('cat')
    expect(update).not.toHaveProperty('description')
    expect(update).not.toHaveProperty('tags')
  })

  it('does not advance sourceModifiedMs when the response is incomplete', async () => {
    // 自愈的关键：sourceModifiedMs 是同步检查点。若残缺响应也把它推进，
    // 下一轮的 unchanged 判定会跳过该作品，残缺状态被永久固化。
    const deps = createDeps({ existingPointRows: makeExistingPoints(1, 50), pointsLength: 50 })
    mockUpstream(1, 50) // 声称 50 个，只返回 1 个 → 不完整
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    expect(readCheckpoint(deps).sourceModifiedMsAdvanced).toBe(false)
    warn.mockRestore()
  })

  it('advances sourceModifiedMs when the response is complete', async () => {
    const deps = createDeps({ existingPointRows: [], pointsLength: 2 })
    mockUpstream(2, 2)

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    expect(readCheckpoint(deps).sourceModifiedMsAdvanced).toBe(true)
  })

  it('holds back the checkpoint when deletion is refused by the ratio cap', async () => {
    // 响应本身完整（返回 5 == 声称 5），但要删掉 20 个里的 15 个（75%）被比例闸门拦下。
    // 此时同步并未收敛：那批陈旧点位还在。若照常推进检查点，下一轮 unchanged 会跳过，
    // 陈旧点位永远清不掉 —— 与残缺响应固化是同一个自锁陷阱。
    const now = new Date('2026-08-09T12:00:00.000Z')
    const deps = createDeps({ existingPointRows: makeExistingPoints(1, 20), pointsLength: 5 })
    ;(deps as { now: () => Date }).now = () => now
    mockUpstream(5, 5)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'full' })

    expect(deps.__calls.deleteMany).not.toHaveBeenCalled()

    const cp = readCheckpoint(deps)
    expect(cp.sourceModifiedMsAdvanced).toBe(false)
    expect(cp.lastCheckedAt!.getTime()).toBeLessThan(now.getTime())

    // 未收敛的工作必须在报告里可见，不能静默堆积。
    expect(report.message).toContain('未收敛')
    warn.mockRestore()
  })

  it('advances the checkpoint when a legitimate deletion goes through', async () => {
    const now = new Date('2026-08-09T12:00:00.000Z')
    const deps = createDeps({ existingPointRows: makeExistingPoints(1, 20), pointsLength: 19 })
    ;(deps as { now: () => Date }).now = () => now
    mockUpstream(19, 19)

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'full' })

    expect(deps.__calls.deleteMany).toHaveBeenCalledTimes(1)

    const cp = readCheckpoint(deps)
    expect(cp.sourceModifiedMsAdvanced).toBe(true)
    expect(cp.lastCheckedAt!.getTime()).toBe(now.getTime())
    expect(report.message ?? '').not.toContain('未收敛')
  })

  it('holds back the checkpoint when mirror reconciliation fails', async () => {
    // 镜像对账失败意味着 R2 里仍是旧图，而 cover/image 字段已指向新 URL ——
    // 图文不一致，本轮没真正同步完。推进检查点会让下一轮跳过，镜像永不修正。
    process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED = '1'
    const now = new Date('2026-08-09T12:00:00.000Z')
    const deps = createDeps({ existingPointRows: [], pointsLength: 2 })
    ;(deps as { now: () => Date }).now = () => now
    mockUpstream(2, 2)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.doMock('@/lib/anitabi/sync/mirrorReconcile', () => ({
      pruneMirrorRowsForDeletedPoints: vi.fn().mockResolvedValue(undefined),
      reconcileMirrorAfterDiff: vi.fn().mockRejectedValue(new Error('reconcile boom')),
    }))

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'full' })

    const cp = readCheckpoint(deps)
    expect(cp.sourceModifiedMsAdvanced).toBe(false)
    expect(cp.lastCheckedAt!.getTime()).toBeLessThan(now.getTime())
    expect(report.message).toContain('未收敛')

    vi.doUnmock('@/lib/anitabi/sync/mirrorReconcile')
    delete process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED
    warn.mockRestore()
  })

  it('holds back the checkpoint when the deletion transaction itself fails', async () => {
    // 闸门放行 ≠ 删除成功。镜像清理事务抛错时会被 catch 吞掉（作品其余部分已同步，
    // 不该整体判失败），但陈旧点位仍在库里 —— 此时推进检查点会让它们永远清不掉。
    process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED = '1'
    const now = new Date('2026-08-09T12:00:00.000Z')
    const deps = createDeps({ existingPointRows: makeExistingPoints(1, 20), pointsLength: 19 })
    ;(deps as { now: () => Date }).now = () => now
    ;(deps.prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('tx boom'))
    mockUpstream(19, 19)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'full' })

    const cp = readCheckpoint(deps)
    expect(cp.sourceModifiedMsAdvanced).toBe(false)
    expect(cp.lastCheckedAt!.getTime()).toBeLessThan(now.getTime())
    expect(report.message).toContain('未收敛')
    delete process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED
    warn.mockRestore()
  })

  it('backdates lastCheckedAt on an incomplete response so the next round retries it', async () => {
    // 既要重试，又不能钉死队首饿死其他作品 —— 所以回拨而非不写。
    const now = new Date('2026-08-09T12:00:00.000Z')
    const deps = createDeps({ existingPointRows: makeExistingPoints(1, 50), pointsLength: 50 })
    ;(deps as { now: () => Date }).now = () => now
    mockUpstream(1, 50)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    const checked = readCheckpoint(deps).lastCheckedAt!
    // 回拨了 6 小时（默认退避），因此排在正常作品之前、但不是绝对队首。
    expect(checked.getTime()).toBe(now.getTime() - 6 * 60 * 60 * 1000)
    expect(checked.getTime()).toBeLessThan(now.getTime())
    warn.mockRestore()
  })

  it('sets lastCheckedAt to now on a complete response', async () => {
    const now = new Date('2026-08-09T12:00:00.000Z')
    const deps = createDeps({ existingPointRows: [], pointsLength: 2 })
    ;(deps as { now: () => Date }).now = () => now
    mockUpstream(2, 2)

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    expect(readCheckpoint(deps).lastCheckedAt!.getTime()).toBe(now.getTime())
  })

  it('never writes the five non-renewable meta JSON fields on update', async () => {
    // 它们来自已停用的摘要端点，写入即净损失且无法恢复。
    const deps = createDeps({ existingPointRows: [], pointsLength: 1 })
    mockUpstream(1, 1)

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    const update = (deps.prisma.anitabiBangumiMeta.upsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.update
    for (const field of ['themeJson', 'customEpNamesJson', 'logsJson', 'removedPointsJson', 'completenessJson']) {
      expect(update).not.toHaveProperty(field)
    }
  })
})

describe('sync endpoint convergence', () => {
  const originalInterval = process.env.ANITABI_SYNC_MIN_INTERVAL_MS

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.enqueueMapTranslationTasksForBangumiIds.mockResolvedValue(null)
    process.env.ANITABI_SYNC_MIN_INTERVAL_MS = '0'
  })

  afterEach(() => {
    if (originalInterval == null) delete process.env.ANITABI_SYNC_MIN_INTERVAL_MS
    else process.env.ANITABI_SYNC_MIN_INTERVAL_MS = originalInterval
  })

  it('only requests the two documented endpoints', async () => {
    // 上游维护者确认「请求授权范围之外的地址」正是 Cloudflare 403 IP Block 的成因，
    // 所以端点集合必须严格收敛到官方文档收录的两个。
    const deps = createDeps({ existingPointRows: [], pointsLength: 1 })
    mockUpstream(1, 1)

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    const urls = mocks.fetchJsonWithRetry.mock.calls.map((c) => String(c[0]))
    expect(urls).toEqual([
      'https://api.anitabi.cn/bangumi/1/lite',
      'https://api.anitabi.cn/bangumi/1/points/detail',
    ])
    // 主域抓取（icons.svg / CHANGELOG.md / d/users.json）已整体移除。
    expect(mocks.fetchTextWithRetry).not.toHaveBeenCalled()
  })

  it('excludes non-positive bangumi ids from the rotation', async () => {
    // 库里存在 id=0 的脏数据（titleZh='#0'，旧同步的兜底值），且排在轮转队首。
    // 对上游发无效请求同样计入 IP 信誉，必须在枚举层就排除。
    const deps = createDeps({ existingPointRows: [], pointsLength: 1 })
    mockUpstream(1, 1)

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    await runAnitabiSync(deps, { mode: 'full' })

    const findManyArgs = (deps.prisma.anitabiBangumi.findMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(findManyArgs.where).toEqual({ id: { gt: 0 } })
  })

  it('skips points/detail when the upstream modified timestamp is unchanged', async () => {
    // 省一次上游请求 —— 频率越低，IP 信誉越安全。
    const deps = createDeps({ existingPointRows: [], pointsLength: 0 })
    ;(deps.prisma.anitabiBangumi.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, sourceModifiedMs: BigInt(555), meta: { pointsLength: 0, lastCheckedAt: null } },
    ])
    mocks.fetchJsonWithRetry.mockResolvedValueOnce({ id: 1, cn: 'W', title: 'W', modified: 555 })

    const { runAnitabiSync } = await import('@/lib/anitabi/sync/workflow')
    const report = await runAnitabiSync(deps, { mode: 'delta' })

    const urls = mocks.fetchJsonWithRetry.mock.calls.map((c) => String(c[0]))
    expect(urls).toEqual(['https://api.anitabi.cn/bangumi/1/lite'])
    expect(report.changed).toBe(0)
  })
})
