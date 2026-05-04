import { describe, expect, it, vi } from 'vitest'

import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'

import { cronDelta, type CronDeltaPrisma } from '../delta'

const CURSOR_KEY = { sourceType: '__cursor__', sourceId: 'delta', variant: '__' } as const

type CursorRow = {
  mirroredAt: Date | null
  canonicalUrl: string | null
}

type ExistingMirrorState = {
  sourceType: string
  sourceId: string
  variant: string
  canonicalUrl: string
  r2Key: string
  status: 'pending' | 'in_progress' | 'mirrored' | 'failed' | 'skipped_404'
  attempts: number
  lastError: string | null
  mirroredAt?: Date | null
  lastAttemptAt?: Date | null
  contentBytes?: number | null
}

function buildStateKey(sourceType: string, sourceId: string, variant: string): string {
  return `${sourceType}:${sourceId}:${variant}`
}

function uniqueConstraintError(): Error & { code: string } {
  return Object.assign(new Error('unique constraint'), { code: 'P2002' as const })
}

type BangumiFindManyArgs = Parameters<CronDeltaPrisma['anitabiBangumi']['findMany']>[0]
type PointFindManyArgs = Parameters<CronDeltaPrisma['anitabiPoint']['findMany']>[0]

function applyBangumiQuery(
  rows: Array<{ id: number; cover: string | null; updatedAt: Date }>,
  args: BangumiFindManyArgs,
) {
  return [...rows]
    .filter((row) => row.cover !== null)
    .filter((row) => row.updatedAt.getTime() <= args.where.updatedAt.lte.getTime())
    .filter((row) =>
      args.where.OR.some((clause) => {
        if ('id' in clause) {
          return (
            row.updatedAt.getTime() === clause.updatedAt.getTime() &&
            row.id > clause.id.gt
          )
        }

        if (clause.updatedAt instanceof Date) {
          return row.updatedAt.getTime() === clause.updatedAt.getTime()
        }

        return row.updatedAt.getTime() > clause.updatedAt.gt.getTime()
      }),
    )
    .sort(
      (left, right) =>
        left.updatedAt.getTime() - right.updatedAt.getTime() || left.id - right.id,
    )
    .slice(0, args.take)
}

function applyPointQuery(
  rows: Array<{ id: string; image: string | null; updatedAt: Date }>,
  args: PointFindManyArgs,
) {
  return [...rows]
    .filter((row) => row.image !== null)
    .filter((row) => row.updatedAt.getTime() <= args.where.updatedAt.lte.getTime())
    .filter((row) =>
      args.where.OR.some((clause) => {
        if ('id' in clause) {
          return (
            row.updatedAt.getTime() === clause.updatedAt.getTime() &&
            row.id > clause.id.gt
          )
        }

        if (clause.updatedAt instanceof Date) {
          return row.updatedAt.getTime() === clause.updatedAt.getTime()
        }

        return row.updatedAt.getTime() > clause.updatedAt.gt.getTime()
      }),
    )
    .sort(
      (left, right) =>
        left.updatedAt.getTime() - right.updatedAt.getTime() || left.id.localeCompare(right.id),
    )
    .slice(0, args.take)
}

function buildPrismaMock(opts: {
  cursorRow?: CursorRow | null
  bangumi?: Array<{ id: number; cover: string | null; updatedAt: Date }>
  points?: Array<{ id: string; image: string | null; updatedAt: Date }>
  mirrorStates?: ExistingMirrorState[]
}) {
  const stateStore = new Map(
    (opts.mirrorStates ?? []).map((state) => [
      buildStateKey(state.sourceType, state.sourceId, state.variant),
      { ...state },
    ]),
  )
  let cursorRow = opts.cursorRow ?? null

  const findUnique = vi
    .fn<CronDeltaPrisma['mapImageMirrorState']['findUnique']>()
    .mockImplementation(async () => cursorRow)
  const create = vi.fn<CronDeltaPrisma['mapImageMirrorState']['create']>().mockImplementation(
    async ({ data }) => {
      const key = buildStateKey(data.sourceType, data.sourceId, data.variant)
      if (stateStore.has(key)) {
        throw uniqueConstraintError()
      }

      stateStore.set(key, {
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        variant: data.variant,
        canonicalUrl: data.canonicalUrl,
        r2Key: data.r2Key,
        status: data.status,
        attempts: 0,
        lastError: null,
        mirroredAt: null,
        lastAttemptAt: null,
        contentBytes: null,
      })

      return {}
    },
  )
  const updateMany = vi
    .fn<CronDeltaPrisma['mapImageMirrorState']['updateMany']>()
    .mockImplementation(async ({ where, data }) => {
      const key = buildStateKey(where.sourceType, where.sourceId, where.variant)
      const state = stateStore.get(key)
      if (!state) {
        return { count: 0 }
      }

      const matchesStatus =
        typeof where.status === 'string'
          ? state.status === where.status
          : new Set<string>(where.status.in).has(state.status)

      if (!matchesStatus) {
        return { count: 0 }
      }

      stateStore.set(key, {
        ...state,
        canonicalUrl: data.canonicalUrl ?? state.canonicalUrl,
        r2Key: data.r2Key ?? state.r2Key,
        status: data.status ?? state.status,
        attempts: data.attempts ?? state.attempts,
        lastError: data.lastError === undefined ? state.lastError : data.lastError,
        mirroredAt: data.mirroredAt === undefined ? state.mirroredAt : data.mirroredAt,
        lastAttemptAt: data.lastAttemptAt === undefined ? state.lastAttemptAt : data.lastAttemptAt,
        contentBytes: data.contentBytes === undefined ? state.contentBytes : data.contentBytes,
      })

      return { count: 1 }
    })
  const upsert = vi.fn<CronDeltaPrisma['mapImageMirrorState']['upsert']>().mockImplementation(
    async ({ create, update }) => {
      cursorRow = cursorRow
        ? {
            ...cursorRow,
            mirroredAt: update.mirroredAt,
            canonicalUrl: update.canonicalUrl,
          }
        : {
            mirroredAt: create.mirroredAt,
            canonicalUrl: create.canonicalUrl,
          }

      return {}
    },
  )
  const bangumiFindMany = vi
    .fn<CronDeltaPrisma['anitabiBangumi']['findMany']>()
    .mockImplementation(async (args) => applyBangumiQuery(opts.bangumi ?? [], args))
  const pointFindMany = vi
    .fn<CronDeltaPrisma['anitabiPoint']['findMany']>()
    .mockImplementation(async (args) => applyPointQuery(opts.points ?? [], args))

  const prisma = {
    mapImageMirrorState: {
      findUnique,
      create,
      updateMany,
      upsert,
    },
    anitabiBangumi: {
      findMany: bangumiFindMany,
    },
    anitabiPoint: {
      findMany: pointFindMany,
    },
  } satisfies CronDeltaPrisma

  return {
    prisma,
    findUnique,
    create,
    updateMany,
    upsert,
    bangumiFindMany,
    pointFindMany,
    stateStore,
    readCursorRow: () => cursorRow,
  }
}

describe('cronDelta', () => {
  it('reads a bounded watermark, limits each source query, creates variants, and advances the cursor to the processed watermark', async () => {
    vi.useFakeTimers()

    try {
      const cursorAt = new Date('2026-05-02T00:00:00Z')
      const upperBound = new Date('2026-05-03T12:00:00Z')
      vi.setSystemTime(upperBound)

      const { prisma, findUnique, create, updateMany, upsert, bangumiFindMany, pointFindMany } =
        buildPrismaMock({
          cursorRow: { mirroredAt: cursorAt, canonicalUrl: 'cursor' },
          bangumi: [
            {
              id: 999,
              cover: 'https://image.anitabi.cn/bangumi/999/cover.jpg',
              updatedAt: new Date('2026-05-03T11:15:00Z'),
            },
          ],
          points: [
            {
              id: 'pn1',
              image: 'https://image.anitabi.cn/points/pn1.jpg',
              updatedAt: new Date('2026-05-03T11:30:00Z'),
            },
          ],
        })

      await expect(cronDelta(prisma, { sourceBatchSize: 25 })).resolves.toEqual({ enqueued: 5 })

      expect(findUnique).toHaveBeenCalledWith({
        where: {
          sourceType_sourceId_variant: CURSOR_KEY,
        },
      })
      expect(bangumiFindMany).toHaveBeenCalledWith({
        where: {
          updatedAt: { lte: upperBound },
          mapEnabled: true,
          cover: { not: null },
          OR: [{ updatedAt: { gt: cursorAt } }, { updatedAt: cursorAt }],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 25,
        select: { id: true, cover: true, updatedAt: true },
      })
      expect(pointFindMany).toHaveBeenCalledWith({
        where: {
          updatedAt: { lte: upperBound },
          image: { not: null },
          OR: [{ updatedAt: { gt: cursorAt } }, { updatedAt: cursorAt }],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 25,
        select: { id: true, image: true, updatedAt: true },
      })
      expect(create).toHaveBeenCalledTimes(5)
      expect(updateMany).not.toHaveBeenCalled()
      expect(create).toHaveBeenNthCalledWith(1, {
        data: {
          sourceType: 'bangumi-cover',
          sourceId: '999',
          variant: 'cover-l',
          canonicalUrl: 'https://image.anitabi.cn/bangumi/999/cover.jpg?plan=l',
          r2Key: await computeMirrorKey(
            'https://image.anitabi.cn/bangumi/999/cover.jpg?plan=l',
            'image/jpeg',
          ),
          status: 'pending',
        },
      })
      expect(create).toHaveBeenNthCalledWith(5, {
        data: {
          sourceType: 'point-image',
          sourceId: 'pn1',
          variant: 'w640q80',
          canonicalUrl: 'https://image.anitabi.cn/points/pn1.jpg?q=80&w=640',
          r2Key: await computeMirrorKey(
            'https://image.anitabi.cn/points/pn1.jpg?q=80&w=640',
            'image/jpeg',
          ),
          status: 'pending',
        },
      })
      expect(upsert).toHaveBeenCalledTimes(1)
      expect(upsert).toHaveBeenCalledWith({
        where: {
          sourceType_sourceId_variant: CURSOR_KEY,
        },
        create: {
          ...CURSOR_KEY,
          canonicalUrl: JSON.stringify({ pointLastId: 'pn1' }),
          r2Key: 'cursor',
          status: 'mirrored',
          mirroredAt: new Date('2026-05-03T11:30:00Z'),
        },
        update: {
          canonicalUrl: JSON.stringify({ pointLastId: 'pn1' }),
          mirroredAt: new Date('2026-05-03T11:30:00Z'),
        },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('does not advance the cursor when no rows are observed', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-05-03T13:00:00Z'))

      const { prisma, create, updateMany, upsert, bangumiFindMany, pointFindMany } =
        buildPrismaMock({})

      await expect(cronDelta(prisma)).resolves.toEqual({ enqueued: 0 })

      expect(bangumiFindMany).toHaveBeenCalledWith({
        where: {
          updatedAt: { lte: new Date('2026-05-03T13:00:00Z') },
          mapEnabled: true,
          cover: { not: null },
          OR: [{ updatedAt: { gt: new Date(0) } }, { updatedAt: new Date(0) }],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 100,
        select: { id: true, cover: true, updatedAt: true },
      })
      expect(pointFindMany).toHaveBeenCalledWith({
        where: {
          updatedAt: { lte: new Date('2026-05-03T13:00:00Z') },
          image: { not: null },
          OR: [{ updatedAt: { gt: new Date(0) } }, { updatedAt: new Date(0) }],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 100,
        select: { id: true, image: true, updatedAt: true },
      })
      expect(create).not.toHaveBeenCalled()
      expect(updateMany).not.toHaveBeenCalled()
      expect(upsert).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('advances a truncated source at the shared timestamp using its last processed id', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-05-03T14:00:00Z'))

      const { prisma, upsert } = buildPrismaMock({
        cursorRow: { mirroredAt: new Date('2026-05-03T10:00:00Z'), canonicalUrl: 'cursor' },
        bangumi: [
          {
            id: 100,
            cover: 'https://image.anitabi.cn/bangumi/100/cover.jpg',
            updatedAt: new Date('2026-05-03T11:00:00Z'),
          },
          {
            id: 101,
            cover: 'https://image.anitabi.cn/bangumi/101/cover.jpg',
            updatedAt: new Date('2026-05-03T12:00:00Z'),
          },
        ],
        points: [],
      })

      await expect(cronDelta(prisma, { sourceBatchSize: 2 })).resolves.toEqual({ enqueued: 4 })

      expect(upsert).toHaveBeenCalledWith({
        where: {
          sourceType_sourceId_variant: CURSOR_KEY,
        },
        create: {
          ...CURSOR_KEY,
          canonicalUrl: JSON.stringify({ bangumiLastId: 101 }),
          r2Key: 'cursor',
          status: 'mirrored',
          mirroredAt: new Date('2026-05-03T12:00:00Z'),
        },
        update: {
          canonicalUrl: JSON.stringify({ bangumiLastId: 101 }),
          mirroredAt: new Date('2026-05-03T12:00:00Z'),
        },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('requeues finished rows, refreshes pending rows in place, and preserves in-progress ownership', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-05-03T15:00:00Z'))

      const mirrorStates: ExistingMirrorState[] = [
        {
          sourceType: 'bangumi-cover',
          sourceId: '999',
          variant: 'cover-l',
          canonicalUrl: 'https://old.example/bangumi-999-cover-l.jpg',
          r2Key: 'old-cover-l',
          status: 'mirrored',
          attempts: 2,
          lastError: null,
          mirroredAt: new Date('2026-05-01T00:00:00Z'),
          lastAttemptAt: new Date('2026-05-01T00:00:00Z'),
          contentBytes: 123,
        },
        {
          sourceType: 'bangumi-cover',
          sourceId: '999',
          variant: 'cover-m',
          canonicalUrl: 'https://old.example/bangumi-999-cover-m.jpg',
          r2Key: 'old-cover-m',
          status: 'failed',
          attempts: 4,
          lastError: 'boom',
          mirroredAt: null,
          lastAttemptAt: new Date('2026-05-01T01:00:00Z'),
          contentBytes: null,
        },
        {
          sourceType: 'point-image',
          sourceId: 'pn1',
          variant: 'h160',
          canonicalUrl: 'https://old.example/pn1-h160.jpg',
          r2Key: 'old-h160',
          status: 'pending',
          attempts: 3,
          lastError: 'stale',
          mirroredAt: null,
          lastAttemptAt: new Date('2026-05-01T02:00:00Z'),
          contentBytes: null,
        },
        {
          sourceType: 'point-image',
          sourceId: 'pn1',
          variant: 'h320',
          canonicalUrl: 'https://old.example/pn1-h320.jpg',
          r2Key: 'old-h320',
          status: 'in_progress',
          attempts: 5,
          lastError: 'working',
          mirroredAt: null,
          lastAttemptAt: new Date('2026-05-03T14:59:00Z'),
          contentBytes: null,
        },
      ]

      const { prisma, upsert, stateStore } = buildPrismaMock({
        cursorRow: { mirroredAt: new Date('2026-05-03T10:00:00Z'), canonicalUrl: 'cursor' },
        bangumi: [
          {
            id: 999,
            cover: 'https://image.anitabi.cn/bangumi/999/cover.jpg',
            updatedAt: new Date('2026-05-03T12:00:00Z'),
          },
        ],
        points: [
          {
            id: 'pn1',
            image: 'https://image.anitabi.cn/points/pn1.jpg',
            updatedAt: new Date('2026-05-03T12:30:00Z'),
          },
        ],
        mirrorStates,
      })

      await expect(cronDelta(prisma)).resolves.toEqual({ enqueued: 3 })

      expect(stateStore.get(buildStateKey('bangumi-cover', '999', 'cover-l'))).toEqual({
        sourceType: 'bangumi-cover',
        sourceId: '999',
        variant: 'cover-l',
        canonicalUrl: 'https://image.anitabi.cn/bangumi/999/cover.jpg?plan=l',
        r2Key: await computeMirrorKey(
          'https://image.anitabi.cn/bangumi/999/cover.jpg?plan=l',
          'image/jpeg',
        ),
        status: 'pending',
        attempts: 0,
        lastError: null,
        mirroredAt: null,
        lastAttemptAt: null,
        contentBytes: null,
      })
      expect(stateStore.get(buildStateKey('bangumi-cover', '999', 'cover-m'))).toEqual({
        sourceType: 'bangumi-cover',
        sourceId: '999',
        variant: 'cover-m',
        canonicalUrl: 'https://image.anitabi.cn/bangumi/999/cover.jpg',
        r2Key: await computeMirrorKey(
          'https://image.anitabi.cn/bangumi/999/cover.jpg',
          'image/jpeg',
        ),
        status: 'pending',
        attempts: 0,
        lastError: null,
        mirroredAt: null,
        lastAttemptAt: null,
        contentBytes: null,
      })
      expect(stateStore.get(buildStateKey('point-image', 'pn1', 'h160'))).toEqual({
        sourceType: 'point-image',
        sourceId: 'pn1',
        variant: 'h160',
        canonicalUrl: 'https://image.anitabi.cn/points/pn1.jpg?plan=h160',
        r2Key: await computeMirrorKey(
          'https://image.anitabi.cn/points/pn1.jpg?plan=h160',
          'image/jpeg',
        ),
        status: 'pending',
        attempts: 0,
        lastError: null,
        mirroredAt: null,
        lastAttemptAt: null,
        contentBytes: null,
      })
      expect(stateStore.get(buildStateKey('point-image', 'pn1', 'h320'))).toEqual({
        sourceType: 'point-image',
        sourceId: 'pn1',
        variant: 'h320',
        canonicalUrl: 'https://old.example/pn1-h320.jpg',
        r2Key: 'old-h320',
        status: 'in_progress',
        attempts: 5,
        lastError: 'working',
        mirroredAt: null,
        lastAttemptAt: new Date('2026-05-03T14:59:00Z'),
        contentBytes: null,
      })
      expect(stateStore.get(buildStateKey('point-image', 'pn1', 'w640q80'))).toEqual({
        sourceType: 'point-image',
        sourceId: 'pn1',
        variant: 'w640q80',
        canonicalUrl: 'https://image.anitabi.cn/points/pn1.jpg?q=80&w=640',
        r2Key: await computeMirrorKey(
          'https://image.anitabi.cn/points/pn1.jpg?q=80&w=640',
          'image/jpeg',
        ),
        status: 'pending',
        attempts: 0,
        lastError: null,
        mirroredAt: null,
        lastAttemptAt: null,
        contentBytes: null,
      })
      expect(upsert).toHaveBeenCalledWith({
        where: {
          sourceType_sourceId_variant: CURSOR_KEY,
        },
        create: {
          ...CURSOR_KEY,
          canonicalUrl: JSON.stringify({ pointLastId: 'pn1' }),
          r2Key: 'cursor',
          status: 'mirrored',
          mirroredAt: new Date('2026-05-03T12:30:00Z'),
        },
        update: {
          canonicalUrl: JSON.stringify({ pointLastId: 'pn1' }),
          mirroredAt: new Date('2026-05-03T12:30:00Z'),
        },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('pages through equal timestamps across repeated runs for both numeric and string source ids', async () => {
    vi.useFakeTimers()

    try {
      const sharedUpdatedAt = new Date('2026-05-03T16:00:00Z')
      vi.setSystemTime(new Date('2026-05-03T17:00:00Z'))

      const { prisma, bangumiFindMany, pointFindMany, readCursorRow } = buildPrismaMock({
        cursorRow: { mirroredAt: new Date('2026-05-03T10:00:00Z'), canonicalUrl: 'cursor' },
        bangumi: [
          {
            id: 1,
            cover: 'https://image.anitabi.cn/bangumi/1/cover.jpg',
            updatedAt: sharedUpdatedAt,
          },
          {
            id: 2,
            cover: 'https://image.anitabi.cn/bangumi/2/cover.jpg',
            updatedAt: sharedUpdatedAt,
          },
          {
            id: 3,
            cover: 'https://image.anitabi.cn/bangumi/3/cover.jpg',
            updatedAt: sharedUpdatedAt,
          },
          {
            id: 4,
            cover: 'https://image.anitabi.cn/bangumi/4/cover.jpg',
            updatedAt: sharedUpdatedAt,
          },
          {
            id: 5,
            cover: 'https://image.anitabi.cn/bangumi/5/cover.jpg',
            updatedAt: sharedUpdatedAt,
          },
        ],
        points: [
          {
            id: 'a',
            image: 'https://image.anitabi.cn/points/a.jpg',
            updatedAt: sharedUpdatedAt,
          },
          {
            id: 'b',
            image: 'https://image.anitabi.cn/points/b.jpg',
            updatedAt: sharedUpdatedAt,
          },
          {
            id: 'c',
            image: 'https://image.anitabi.cn/points/c.jpg',
            updatedAt: sharedUpdatedAt,
          },
          {
            id: 'd',
            image: 'https://image.anitabi.cn/points/d.jpg',
            updatedAt: sharedUpdatedAt,
          },
          {
            id: 'e',
            image: 'https://image.anitabi.cn/points/e.jpg',
            updatedAt: sharedUpdatedAt,
          },
        ],
      })

      await expect(cronDelta(prisma, { sourceBatchSize: 2 })).resolves.toEqual({ enqueued: 10 })
      expect(readCursorRow()).toEqual({
        mirroredAt: sharedUpdatedAt,
        canonicalUrl: JSON.stringify({ bangumiLastId: 2, pointLastId: 'b' }),
      })

      await expect(cronDelta(prisma, { sourceBatchSize: 2 })).resolves.toEqual({ enqueued: 10 })
      expect(readCursorRow()).toEqual({
        mirroredAt: sharedUpdatedAt,
        canonicalUrl: JSON.stringify({ bangumiLastId: 4, pointLastId: 'd' }),
      })

      await expect(cronDelta(prisma, { sourceBatchSize: 2 })).resolves.toEqual({ enqueued: 5 })
      expect(readCursorRow()).toEqual({
        mirroredAt: sharedUpdatedAt,
        canonicalUrl: JSON.stringify({ bangumiLastId: 5, pointLastId: 'e' }),
      })

      expect(bangumiFindMany).toHaveBeenNthCalledWith(1, {
        where: {
          updatedAt: { lte: new Date('2026-05-03T17:00:00Z') },
          mapEnabled: true,
          cover: { not: null },
          OR: [
            { updatedAt: { gt: new Date('2026-05-03T10:00:00Z') } },
            { updatedAt: new Date('2026-05-03T10:00:00Z') },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 2,
        select: { id: true, cover: true, updatedAt: true },
      })
      expect(bangumiFindMany).toHaveBeenNthCalledWith(2, {
        where: {
          updatedAt: { lte: new Date('2026-05-03T17:00:00Z') },
          mapEnabled: true,
          cover: { not: null },
          OR: [
            { updatedAt: { gt: sharedUpdatedAt } },
            { updatedAt: sharedUpdatedAt, id: { gt: 2 } },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 2,
        select: { id: true, cover: true, updatedAt: true },
      })
      expect(bangumiFindMany).toHaveBeenNthCalledWith(3, {
        where: {
          updatedAt: { lte: new Date('2026-05-03T17:00:00Z') },
          mapEnabled: true,
          cover: { not: null },
          OR: [
            { updatedAt: { gt: sharedUpdatedAt } },
            { updatedAt: sharedUpdatedAt, id: { gt: 4 } },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 2,
        select: { id: true, cover: true, updatedAt: true },
      })
      expect(pointFindMany).toHaveBeenNthCalledWith(2, {
        where: {
          updatedAt: { lte: new Date('2026-05-03T17:00:00Z') },
          image: { not: null },
          OR: [
            { updatedAt: { gt: sharedUpdatedAt } },
            { updatedAt: sharedUpdatedAt, id: { gt: 'b' } },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 2,
        select: { id: true, image: true, updatedAt: true },
      })
      expect(pointFindMany).toHaveBeenNthCalledWith(3, {
        where: {
          updatedAt: { lte: new Date('2026-05-03T17:00:00Z') },
          image: { not: null },
          OR: [
            { updatedAt: { gt: sharedUpdatedAt } },
            { updatedAt: sharedUpdatedAt, id: { gt: 'd' } },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 2,
        select: { id: true, image: true, updatedAt: true },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('includes boundary equality for sources without a tie-breaker while continuing tied sources from their last id', async () => {
    vi.useFakeTimers()

    try {
      const sharedUpdatedAt = new Date('2026-05-03T18:00:00Z')
      vi.setSystemTime(new Date('2026-05-03T19:00:00Z'))

      const bangumiRows = [
        {
          id: 1,
          cover: 'https://image.anitabi.cn/bangumi/1/cover.jpg',
          updatedAt: sharedUpdatedAt,
        },
        {
          id: 2,
          cover: 'https://image.anitabi.cn/bangumi/2/cover.jpg',
          updatedAt: sharedUpdatedAt,
        },
      ]
      const pointRows: Array<{ id: string; image: string | null; updatedAt: Date }> = []

      const { prisma, bangumiFindMany, pointFindMany, readCursorRow } = buildPrismaMock({
        cursorRow: { mirroredAt: new Date('2026-05-03T10:00:00Z'), canonicalUrl: 'cursor' },
        bangumi: bangumiRows,
        points: pointRows,
      })

      await expect(cronDelta(prisma, { sourceBatchSize: 1 })).resolves.toEqual({ enqueued: 2 })
      expect(readCursorRow()).toEqual({
        mirroredAt: sharedUpdatedAt,
        canonicalUrl: JSON.stringify({ bangumiLastId: 1 }),
      })

      pointRows.push({
        id: 'pt-1',
        image: 'https://image.anitabi.cn/points/pt-1.jpg',
        updatedAt: sharedUpdatedAt,
      })

      await expect(cronDelta(prisma, { sourceBatchSize: 1 })).resolves.toEqual({ enqueued: 5 })
      expect(readCursorRow()).toEqual({
        mirroredAt: sharedUpdatedAt,
        canonicalUrl: JSON.stringify({ bangumiLastId: 2, pointLastId: 'pt-1' }),
      })

      expect(bangumiFindMany).toHaveBeenNthCalledWith(2, {
        where: {
          updatedAt: { lte: new Date('2026-05-03T19:00:00Z') },
          mapEnabled: true,
          cover: { not: null },
          OR: [
            { updatedAt: { gt: sharedUpdatedAt } },
            { updatedAt: sharedUpdatedAt, id: { gt: 1 } },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { id: true, cover: true, updatedAt: true },
      })
      expect(pointFindMany).toHaveBeenNthCalledWith(2, {
        where: {
          updatedAt: { lte: new Date('2026-05-03T19:00:00Z') },
          image: { not: null },
          OR: [
            { updatedAt: { gt: sharedUpdatedAt } },
            { updatedAt: sharedUpdatedAt },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { id: true, image: true, updatedAt: true },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})
