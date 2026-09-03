import { afterEach, describe, expect, it, vi } from 'vitest'
import { cronDelta, type CronDeltaPrisma } from '@/lib/anitabi/mirror/delta'

const CURSOR_KEY = { sourceType: '__cursor__', sourceId: 'delta', variant: '__' } as const

type PointFixture = { id: string; image: string | null; updatedAt: Date }

function buildDeltaPrisma(opts: {
  cursorRow?: { mirroredAt: Date | null; canonicalUrl: string | null }
  points?: PointFixture[]
  existingPointStateIds?: string[]
  withBackfillSupport?: boolean
}) {
  const points = opts.points ?? []
  const existingPointStateIds = new Set(opts.existingPointStateIds ?? [])
  const createdRows: Array<{ sourceType: string; sourceId: string; variant: string; status: string }> = []
  const pointQueries: unknown[] = []
  const stateQueries: unknown[] = []
  let cursorRow = opts.cursorRow ?? null

  const findUnique = vi.fn<CronDeltaPrisma['mapImageMirrorState']['findUnique']>().mockImplementation(
    async ({ where }) => {
      if (where.sourceType_sourceId_variant.sourceType === CURSOR_KEY.sourceType) {
        return cursorRow
      }
      return null
    },
  )
  const create = vi.fn<CronDeltaPrisma['mapImageMirrorState']['create']>().mockImplementation(
    async ({ data }) => {
      createdRows.push({
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        variant: data.variant,
        status: data.status,
      })
      return {}
    },
  )
  const updateMany = vi.fn<CronDeltaPrisma['mapImageMirrorState']['updateMany']>().mockResolvedValue({ count: 0 })
  const upsert = vi.fn<CronDeltaPrisma['mapImageMirrorState']['upsert']>().mockImplementation(async ({ update }) => {
    cursorRow = { mirroredAt: update.mirroredAt, canonicalUrl: update.canonicalUrl }
    return {}
  })

  const bangumiFindMany = vi.fn<CronDeltaPrisma['anitabiBangumi']['findMany']>().mockResolvedValue([])
  const pointFindMany = vi.fn(async (args: any) => {
    pointQueries.push(args)
    if (args.where && 'id' in args.where) {
      return points
        .filter((row) => row.image !== null)
        .filter((row) => !(args.where.id.notIn as string[]).includes(row.id))
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, args.take)
        .map((row) => ({ id: row.id, image: row.image as string }))
    }
    return []
  })

  const mapImageMirrorState: Record<string, unknown> = {
    findUnique,
    create,
    updateMany,
    upsert,
  }
  if (opts.withBackfillSupport !== false) {
    mapImageMirrorState.findMany = vi.fn(async (args: any) => {
      stateQueries.push(args)
      return [...existingPointStateIds].map((sourceId) => ({ sourceId }))
    })
  }

  const prisma = {
    mapImageMirrorState,
    anitabiBangumi: { findMany: bangumiFindMany },
    anitabiPoint: { findMany: pointFindMany },
  } as unknown as CronDeltaPrisma

  return { prisma, createdRows, pointQueries, stateQueries }
}

describe('cronDelta missing point-state backfill', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('enqueues both pending variants for points that have images but no mirror state', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-03T12:00:00Z')
    vi.setSystemTime(now)

    const { prisma, createdRows } = buildDeltaPrisma({
      cursorRow: { mirroredAt: now, canonicalUrl: null },
      points: [
        { id: 'p1', image: 'https://image.anitabi.cn/points/38125/y.jpg', updatedAt: new Date(now.getTime() - 3_600_000) },
        { id: 'p2', image: 'https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg', updatedAt: new Date(now.getTime() - 3_600_000) },
      ],
      existingPointStateIds: [],
    })

    const result = await cronDelta(prisma)

    expect(result.enqueued).toBe(4)
    expect(createdRows).toEqual([
      { sourceType: 'point-image', sourceId: 'p1', variant: 'h160', status: 'pending' },
      { sourceType: 'point-image', sourceId: 'p1', variant: 'w640q80', status: 'pending' },
      { sourceType: 'point-image', sourceId: 'p2', variant: 'h160', status: 'pending' },
      { sourceType: 'point-image', sourceId: 'p2', variant: 'w640q80', status: 'pending' },
    ])
  })

  it('skips points that already have mirror state rows', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-03T12:00:00Z')
    vi.setSystemTime(now)

    const { prisma, createdRows } = buildDeltaPrisma({
      cursorRow: { mirroredAt: now, canonicalUrl: null },
      points: [
        { id: 'p1', image: 'https://image.anitabi.cn/points/38125/y.jpg', updatedAt: new Date(now.getTime() - 3_600_000) },
        { id: 'p2', image: 'https://image.anitabi.cn/points/38126/z.jpg', updatedAt: new Date(now.getTime() - 3_600_000) },
      ],
      existingPointStateIds: ['p1'],
    })

    const result = await cronDelta(prisma)

    expect(result.enqueued).toBe(2)
    expect(createdRows.every((row) => row.sourceId === 'p2')).toBe(true)
  })

  it('caps the backfill at 500 points per tick', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-03T12:00:00Z')
    vi.setSystemTime(now)

    const points: PointFixture[] = Array.from({ length: 600 }, (_, index) => ({
      id: `p-${String(index).padStart(4, '0')}`,
      image: `https://image.anitabi.cn/points/${index}/a.jpg`,
      updatedAt: new Date(now.getTime() - 3_600_000),
    }))

    const { prisma, createdRows, pointQueries } = buildDeltaPrisma({
      cursorRow: { mirroredAt: now, canonicalUrl: null },
      points,
      existingPointStateIds: [],
    })

    const result = await cronDelta(prisma)

    expect(result.enqueued).toBe(1_000)
    expect(createdRows).toHaveLength(1_000)
    const backfillQuery = pointQueries.find((query: any) => query.where && 'id' in query.where)
    expect((backfillQuery as any)?.take).toBe(500)
  })

  it('does not throw when the prisma double lacks backfill support (worker-mock compatibility)', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-03T12:00:00Z')
    vi.setSystemTime(now)

    const { prisma, createdRows } = buildDeltaPrisma({
      cursorRow: { mirroredAt: now, canonicalUrl: null },
      points: [
        { id: 'p1', image: 'https://image.anitabi.cn/points/38125/y.jpg', updatedAt: new Date(now.getTime() - 3_600_000) },
      ],
      withBackfillSupport: false,
    })

    const result = await cronDelta(prisma)

    expect(result).toEqual({ enqueued: 0 })
    expect(createdRows).toEqual([])
  })
})
