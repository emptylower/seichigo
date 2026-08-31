import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'

const mocks = {
  fetchBulkIndex: vi.fn(),
  fetchBulkPage: vi.fn(),
  enqueueMapTranslationTasksForBangumiIds: vi.fn(),
}

vi.mock('@/lib/anitabi/source/bulkClient', () => ({
  getAnitabiBulkBase: () => 'https://bulk.test',
  fetchBulkIndex: mocks.fetchBulkIndex,
  fetchBulkPage: mocks.fetchBulkPage,
}))
vi.mock('@/lib/translation/mapTaskEnqueue', () => ({
  enqueueMapTranslationTasksForBangumiIds: mocks.enqueueMapTranslationTasksForBangumiIds,
}))

// —— fixtures：解码后形态直接喂（decode 层已单独测过）——
function bulkIndex(modified: number, pointIds: string[] = ['p0']) {
  return {
    modified,
    pageSize: 250,
    pageCount: 1,
    entries: [{
      id: 1, cn: 'Work', en: null, title: 'ワーク', city: null, color: '#fff',
      cover: 'https://image.anitabi.cn/bangumi/1.jpg', cat: 'TV', tags: ['tag1'],
      geoLat: 35, geoLng: 139, zoom: 10,
      points: pointIds.map((id) => ({ id, geoLat: 35, geoLng: 139 })),
    }],
  }
}
function bulkPage(modified: number, pointIds: string[] = ['p0']) {
  return [{
    id: 1, modified,
    theme: { src: 'https://image.anitabi.cn/ptheme/1.webp', ids: pointIds },
    points: pointIds.map((id) => ({
      id, name: `P${id}`, isFolder: false,
      image: `https://image.anitabi.cn/points/1/${id}_123.jpg`,
      density: 5, folder: 'f', uid: '9', mark: 'm',
    })),
  }]
}

function createDeps(input: {
  knownSourceModifiedMs?: bigint | null
  cursorValue?: string | null
  existingPointRows?: Array<{ id: string; image: string | null }>
}) {
  const calls = {
    bangumiUpsert: vi.fn().mockResolvedValue({}),
    metaUpsert: vi.fn().mockResolvedValue({}),
    pointCreateMany: vi.fn().mockResolvedValue({ count: 0 }),
    pointUpdate: vi.fn().mockResolvedValue({}),
    pointDeleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    cursorUpsert: vi.fn().mockResolvedValue({}),
    runUpdate: vi.fn().mockResolvedValue({}),
  }
  const deps = {
    prisma: {
      anitabiSyncRun: { create: vi.fn().mockResolvedValue({ id: 'run-1' }), update: calls.runUpdate },
      anitabiBangumi: {
        findMany: vi.fn().mockResolvedValue(
          input.knownSourceModifiedMs === undefined
            ? []
            : [{ id: 1, sourceModifiedMs: input.knownSourceModifiedMs }],
        ),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: calls.bangumiUpsert,
        update: vi.fn().mockResolvedValue({}),
      },
      anitabiBangumiMeta: { upsert: calls.metaUpsert, update: vi.fn().mockResolvedValue({}) },
      anitabiPoint: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue(input.existingPointRows ?? []),
        createMany: calls.pointCreateMany,
        update: calls.pointUpdate,
        deleteMany: calls.pointDeleteMany,
      },
      anitabiSourceCursor: {
        findUnique: vi.fn().mockResolvedValue(
          input.cursorValue != null ? { value: input.cursorValue } : null,
        ),
        upsert: calls.cursorUpsert,
      },
      $transaction: vi.fn().mockImplementation(async (i: unknown) =>
        typeof i === 'function' ? (i as (tx: unknown) => unknown)({}) : i,
      ),
    } as unknown as AnitabiApiDeps['prisma'],
    getSession: async () => null,
    now: () => new Date('2026-08-31T00:00:00.000Z'),
    getCronSecret: () => '',
    getApiBase: () => 'https://api.anitabi.cn',
    getSiteBase: () => '',
  } as unknown as AnitabiApiDeps
  return { deps, calls }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.enqueueMapTranslationTasksForBangumiIds.mockResolvedValue(null)
  process.env.ANITABI_SYNC_MIN_INTERVAL_MS = '0'
})

describe('runAnitabiBulkSync', () => {
  it('delta 短路：数据集 modified 未前进时只打索引、不打分页、不写库', async () => {
    const { runAnitabiBulkSync } = await import('@/lib/anitabi/sync/bulkWorkflow')
    mocks.fetchBulkIndex.mockResolvedValue(bulkIndex(1000))
    const { deps, calls } = createDeps({ cursorValue: '1000' })
    const report = await runAnitabiBulkSync(deps, { mode: 'delta' })
    expect(report.status).toBe('ok')
    expect(report.scanned).toBe(0)
    expect(mocks.fetchBulkPage).not.toHaveBeenCalled()
    expect(calls.bangumiUpsert).not.toHaveBeenCalled()
  })

  it('新作品创建 + 可再生字段回填 + 游标推进', async () => {
    const { runAnitabiBulkSync } = await import('@/lib/anitabi/sync/bulkWorkflow')
    mocks.fetchBulkIndex.mockResolvedValue(bulkIndex(2000))
    mocks.fetchBulkPage.mockResolvedValue(bulkPage(1900))
    const { deps, calls } = createDeps({ cursorValue: '1000' })
    const report = await runAnitabiBulkSync(deps, { mode: 'delta' })
    expect(report.status).toBe('ok')
    expect(report.changed).toBe(1)
    // 作品 upsert 带上 cat/tags
    const up = calls.bangumiUpsert.mock.calls[0]![0]
    expect(up.update.cat).toBe('TV')
    expect(up.update.tags).toEqual(['tag1'])
    // meta 带实算计数与 themeJson
    const meta = calls.metaUpsert.mock.calls[0]![0]
    expect(meta.update.pointsLength).toBe(1)
    expect(meta.update.imagesLength).toBe(1)
    expect(meta.update.themeJson).toMatchObject({ src: expect.stringContaining('ptheme'), ids: ['p0'] })
    // 新点位含回填字段、不含冻结字段
    const created = calls.pointCreateMany.mock.calls[0]![0].data[0]
    expect(created).toMatchObject({ id: '1:p0', density: 5, folder: 'f', uid: '9', mark: 'm' })
    expect('reviewUid' in created).toBe(false)
    expect('originUrl' in created).toBe(false)
    // 全部收敛 → 数据集游标推进到 2000
    const cursorCalls = calls.cursorUpsert.mock.calls.map((c) => c[0])
    expect(cursorCalls.some((c) => c.where.sourceName === 'bulkDatasetModified'
      && c.update.value === '2000')).toBe(true)
  })

  it('作品级 modified 未变则跳过写库', async () => {
    const { runAnitabiBulkSync } = await import('@/lib/anitabi/sync/bulkWorkflow')
    mocks.fetchBulkIndex.mockResolvedValue(bulkIndex(2000))
    mocks.fetchBulkPage.mockResolvedValue(bulkPage(1900))
    const { deps, calls } = createDeps({ cursorValue: '1000', knownSourceModifiedMs: BigInt(1900) })
    // 库内点位数已齐（1/1）——否则 needsBackfill 会刻意绕过 modified 跳过（D5 回填设计）
    ;(deps.prisma.anitabiPoint.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { bangumiId: 1, _count: { _all: 1 } },
    ])
    const report = await runAnitabiBulkSync(deps, { mode: 'delta' })
    expect(report.changed).toBe(0)
    expect(calls.bangumiUpsert).not.toHaveBeenCalled()
  })

  it('索引点位 id 在分页缺失 → defer，不删点、游标不推进', async () => {
    const { runAnitabiBulkSync } = await import('@/lib/anitabi/sync/bulkWorkflow')
    mocks.fetchBulkIndex.mockResolvedValue(bulkIndex(2000, ['p0', 'p1']))
    mocks.fetchBulkPage.mockResolvedValue(bulkPage(1900, ['p0'])) // p1 缺失
    const { deps, calls } = createDeps({
      cursorValue: '1000',
      existingPointRows: [{ id: '1:p0', image: null }, { id: '1:p1', image: null }],
    })
    const report = await runAnitabiBulkSync(deps, { mode: 'delta' })
    expect(report.status).toBe('ok')
    expect(report.message).toContain('未收敛')
    expect(calls.pointDeleteMany).not.toHaveBeenCalled()
    const cursorCalls = calls.cursorUpsert.mock.calls.map((c) => c[0])
    expect(cursorCalls.some((c) => c.where.sourceName === 'bulkDatasetModified')).toBe(false)
  })

  it('解码/取数抛错 → run 记 failed 且 errorSummary 可见', async () => {
    const { runAnitabiBulkSync } = await import('@/lib/anitabi/sync/bulkWorkflow')
    mocks.fetchBulkIndex.mockRejectedValue(new Error('[anitabi/bulk] index: rows must be a non-empty array'))
    const { deps, calls } = createDeps({})
    const report = await runAnitabiBulkSync(deps, { mode: 'delta' })
    expect(report.status).toBe('failed')
    expect(calls.runUpdate.mock.calls.at(-1)![0].data.status).toBe('failed')
  })
})
