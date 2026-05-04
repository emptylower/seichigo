import { describe, expect, it, vi } from 'vitest'

import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'
import {
  advanceBootstrap,
  type AdvanceBootstrapPrisma,
  type AdvanceBootstrapTransactionPrisma,
} from '@/lib/anitabi/mirror/bootstrap'

type BootstrapState = {
  id: number
  bangumiCursor: number | null
  pointCursor: string | null
  bangumiCompleted: boolean
  pointCompleted: boolean
  totalEnumerated: number
  startedAt?: Date | null
  completedAt?: Date | null
  lastAdvanceAt?: Date | null
  manuallyTriggered?: boolean
}

function buildPrismaMock(opts: {
  bangumi?: Array<{ id: number; cover: string | null }>
  points?: Array<{ id: string; image: string | null }>
  bsState: BootstrapState
  createManyCount?: number
  transactionCreateManyCount?: number
  transactionUpdateError?: Error
}) {
  const bootstrapUpsert = vi
    .fn<AdvanceBootstrapPrisma['mapImageMirrorBootstrap']['upsert']>()
    .mockResolvedValue(opts.bsState)
  const bootstrapUpdate = vi
    .fn<AdvanceBootstrapPrisma['mapImageMirrorBootstrap']['update']>()
    .mockImplementation(async ({ data }) => ({
      ...opts.bsState,
      ...data,
    }))
  const bangumiFindMany = vi
    .fn<AdvanceBootstrapPrisma['anitabiBangumi']['findMany']>()
    .mockResolvedValue(opts.bangumi ?? [])
  const pointFindMany = vi
    .fn<AdvanceBootstrapPrisma['anitabiPoint']['findMany']>()
    .mockResolvedValue(opts.points ?? [])
  const createMany = vi
    .fn<AdvanceBootstrapPrisma['mapImageMirrorState']['createMany']>()
    .mockResolvedValue({ count: opts.createManyCount ?? 0 })
  const transactionBootstrapUpdate = vi
    .fn<AdvanceBootstrapTransactionPrisma['mapImageMirrorBootstrap']['update']>()
    .mockImplementation(async ({ data }) => {
      if (opts.transactionUpdateError) {
        throw opts.transactionUpdateError
      }

      return {
        ...opts.bsState,
        ...data,
      }
    })
  const transactionCreateMany = vi
    .fn<AdvanceBootstrapTransactionPrisma['mapImageMirrorState']['createMany']>()
    .mockResolvedValue({
      count: opts.transactionCreateManyCount ?? opts.createManyCount ?? 0,
    })
  const transactionImpl: AdvanceBootstrapPrisma['$transaction'] = async (callback) =>
    callback({
      mapImageMirrorBootstrap: {
        update: transactionBootstrapUpdate,
      },
      mapImageMirrorState: {
        createMany: transactionCreateMany,
      },
    })
  const transaction = vi.fn(transactionImpl)

  const prisma: AdvanceBootstrapPrisma = {
    $transaction: transaction as AdvanceBootstrapPrisma['$transaction'],
    mapImageMirrorBootstrap: {
      upsert: bootstrapUpsert,
      update: bootstrapUpdate,
    },
    anitabiBangumi: {
      findMany: bangumiFindMany,
    },
    anitabiPoint: {
      findMany: pointFindMany,
    },
    mapImageMirrorState: {
      createMany,
    },
  }

  return {
    prisma,
    transaction,
    bootstrapUpsert,
    bootstrapUpdate,
    bangumiFindMany,
    pointFindMany,
    createMany,
    transactionBootstrapUpdate,
    transactionCreateMany,
  }
}

describe('advanceBootstrap', () => {
  it('enumerates bangumi cover variants and advances the bangumi cursor', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

      const {
        prisma,
        createMany,
        pointFindMany,
        bootstrapUpdate,
        bootstrapUpsert,
        bangumiFindMany,
        transaction,
        transactionBootstrapUpdate,
        transactionCreateMany,
      } = buildPrismaMock({
        bangumi: [{ id: 1, cover: 'https://image.anitabi.cn/bangumi/1/cover.jpg' }],
        bsState: {
          id: 1,
          bangumiCursor: null,
          pointCursor: null,
          bangumiCompleted: false,
          pointCompleted: false,
          totalEnumerated: 0,
        },
        transactionCreateManyCount: 2,
      })

      await advanceBootstrap(prisma, 100)

      expect(bootstrapUpsert).toHaveBeenCalledWith({
        where: { id: 1 },
        create: { id: 1, startedAt: new Date('2026-05-03T12:00:00Z') },
        update: {},
      })
      expect(bangumiFindMany).toHaveBeenCalledWith({
        where: { mapEnabled: true, cover: { not: null } },
        orderBy: { id: 'asc' },
        take: 100,
        select: { id: true, cover: true },
      })
      expect(pointFindMany).not.toHaveBeenCalled()
      expect(transaction).toHaveBeenCalledTimes(1)
      expect(createMany).not.toHaveBeenCalled()
      expect(bootstrapUpdate).not.toHaveBeenCalled()
      expect(transactionCreateMany).toHaveBeenCalledWith({
        data: [
          {
            sourceType: 'bangumi-cover',
            sourceId: '1',
            variant: 'cover-l',
            canonicalUrl: 'https://image.anitabi.cn/bangumi/1/cover.jpg?plan=l',
            r2Key: await computeMirrorKey(
              'https://image.anitabi.cn/bangumi/1/cover.jpg?plan=l',
              'image/jpeg',
            ),
            status: 'pending',
          },
          {
            sourceType: 'bangumi-cover',
            sourceId: '1',
            variant: 'cover-m',
            canonicalUrl: 'https://image.anitabi.cn/bangumi/1/cover.jpg',
            r2Key: await computeMirrorKey('https://image.anitabi.cn/bangumi/1/cover.jpg', 'image/jpeg'),
            status: 'pending',
          },
        ],
        skipDuplicates: true,
      })
      expect(transactionBootstrapUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          bangumiCursor: 1,
          totalEnumerated: { increment: 2 },
          lastAdvanceAt: new Date('2026-05-03T12:00:00Z'),
        },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('counts only newly created bangumi variants when duplicate rows are skipped', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-05-03T12:30:00Z'))

      const { prisma, createMany, bootstrapUpdate, transactionBootstrapUpdate, transactionCreateMany } =
        buildPrismaMock({
        bangumi: [{ id: 2, cover: 'https://image.anitabi.cn/bangumi/2/cover.jpg' }],
        bsState: {
          id: 1,
          bangumiCursor: 1,
          pointCursor: null,
          bangumiCompleted: false,
          pointCompleted: false,
          totalEnumerated: 5,
        },
        transactionCreateManyCount: 1,
      })

      await advanceBootstrap(prisma, 100)

      expect(createMany).not.toHaveBeenCalled()
      expect(bootstrapUpdate).not.toHaveBeenCalled()
      expect(transactionCreateMany).toHaveBeenCalledWith({
        data: [
          {
            sourceType: 'bangumi-cover',
            sourceId: '2',
            variant: 'cover-l',
            canonicalUrl: 'https://image.anitabi.cn/bangumi/2/cover.jpg?plan=l',
            r2Key: await computeMirrorKey(
              'https://image.anitabi.cn/bangumi/2/cover.jpg?plan=l',
              'image/jpeg',
            ),
            status: 'pending',
          },
          {
            sourceType: 'bangumi-cover',
            sourceId: '2',
            variant: 'cover-m',
            canonicalUrl: 'https://image.anitabi.cn/bangumi/2/cover.jpg',
            r2Key: await computeMirrorKey('https://image.anitabi.cn/bangumi/2/cover.jpg', 'image/jpeg'),
            status: 'pending',
          },
        ],
        skipDuplicates: true,
      })
      expect(transactionBootstrapUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          bangumiCursor: 2,
          totalEnumerated: { increment: 1 },
          lastAdvanceAt: new Date('2026-05-03T12:30:00Z'),
        },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('marks bangumi completed and does not process points in the same tick when no bangumi rows remain', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-05-03T13:00:00Z'))

      const { prisma, createMany, pointFindMany, bootstrapUpdate, bangumiFindMany } = buildPrismaMock({
        bangumi: [],
        points: [{ id: 'p1', image: 'https://image.anitabi.cn/points/p1.jpg' }],
        bsState: {
          id: 1,
          bangumiCursor: 99,
          pointCursor: null,
          bangumiCompleted: false,
          pointCompleted: false,
          totalEnumerated: 5,
        },
      })

      await advanceBootstrap(prisma, 100)

      expect(bangumiFindMany).toHaveBeenCalledWith({
        where: { id: { gt: 99 }, mapEnabled: true, cover: { not: null } },
        orderBy: { id: 'asc' },
        take: 100,
        select: { id: true, cover: true },
      })
      expect(pointFindMany).not.toHaveBeenCalled()
      expect(createMany).not.toHaveBeenCalled()
      expect(bootstrapUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          bangumiCompleted: true,
          lastAdvanceAt: new Date('2026-05-03T13:00:00Z'),
        },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('enumerates point image variants once bangumi bootstrap is complete', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-05-03T14:00:00Z'))

      const {
        prisma,
        createMany,
        bootstrapUpdate,
        bangumiFindMany,
        pointFindMany,
        transactionBootstrapUpdate,
        transactionCreateMany,
      } = buildPrismaMock({
        points: [{ id: 'pt-1', image: 'https://image.anitabi.cn/points/pt-1.jpg' }],
        bsState: {
          id: 1,
          bangumiCursor: 123,
          pointCursor: null,
          bangumiCompleted: true,
          pointCompleted: false,
          totalEnumerated: 7,
        },
        transactionCreateManyCount: 3,
      })

      await advanceBootstrap(prisma, 50)

      expect(bangumiFindMany).not.toHaveBeenCalled()
      expect(pointFindMany).toHaveBeenCalledWith({
        where: { image: { not: null } },
        orderBy: { id: 'asc' },
        take: 50,
        select: { id: true, image: true },
      })
      expect(createMany).not.toHaveBeenCalled()
      expect(bootstrapUpdate).not.toHaveBeenCalled()
      expect(transactionCreateMany).toHaveBeenCalledTimes(1)
      expect(transactionCreateMany).toHaveBeenCalledWith({
        data: [
          {
            sourceType: 'point-image',
            sourceId: 'pt-1',
            variant: 'h160',
            canonicalUrl: 'https://image.anitabi.cn/points/pt-1.jpg?plan=h160',
            r2Key: await computeMirrorKey(
              'https://image.anitabi.cn/points/pt-1.jpg?plan=h160',
              'image/jpeg',
            ),
            status: 'pending',
          },
          {
            sourceType: 'point-image',
            sourceId: 'pt-1',
            variant: 'h320',
            canonicalUrl: 'https://image.anitabi.cn/points/pt-1.jpg?plan=h320',
            r2Key: await computeMirrorKey(
              'https://image.anitabi.cn/points/pt-1.jpg?plan=h320',
              'image/jpeg',
            ),
            status: 'pending',
          },
          {
            sourceType: 'point-image',
            sourceId: 'pt-1',
            variant: 'w640q80',
            canonicalUrl: 'https://image.anitabi.cn/points/pt-1.jpg?q=80&w=640',
            r2Key: await computeMirrorKey(
              'https://image.anitabi.cn/points/pt-1.jpg?q=80&w=640',
              'image/jpeg',
            ),
            status: 'pending',
          },
        ],
        skipDuplicates: true,
      })
      expect(transactionBootstrapUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          pointCursor: 'pt-1',
          totalEnumerated: { increment: 3 },
          lastAdvanceAt: new Date('2026-05-03T14:00:00Z'),
        },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('marks point bootstrap completed and stamps completedAt when no point rows remain', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-05-03T15:00:00Z'))

      const { prisma, createMany, bootstrapUpdate, pointFindMany } = buildPrismaMock({
        points: [],
        bsState: {
          id: 1,
          bangumiCursor: 123,
          pointCursor: 'pt-99',
          bangumiCompleted: true,
          pointCompleted: false,
          totalEnumerated: 10,
        },
      })

      await advanceBootstrap(prisma, 25)

      expect(pointFindMany).toHaveBeenCalledWith({
        where: { id: { gt: 'pt-99' }, image: { not: null } },
        orderBy: { id: 'asc' },
        take: 25,
        select: { id: true, image: true },
      })
      expect(createMany).not.toHaveBeenCalled()
      expect(bootstrapUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          pointCompleted: true,
          completedAt: new Date('2026-05-03T15:00:00Z'),
          lastAdvanceAt: new Date('2026-05-03T15:00:00Z'),
        },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('rejects non-positive and non-finite chunk sizes before querying bootstrap state', async () => {
    for (const chunkSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { prisma, bootstrapUpsert, bootstrapUpdate, bangumiFindMany, pointFindMany, createMany } =
        buildPrismaMock({
          bsState: {
            id: 1,
            bangumiCursor: null,
            pointCursor: null,
            bangumiCompleted: false,
            pointCompleted: false,
            totalEnumerated: 0,
          },
        })

      await expect(advanceBootstrap(prisma, chunkSize)).rejects.toThrow(RangeError)
      expect(bootstrapUpsert).not.toHaveBeenCalled()
      expect(bootstrapUpdate).not.toHaveBeenCalled()
      expect(bangumiFindMany).not.toHaveBeenCalled()
      expect(pointFindMany).not.toHaveBeenCalled()
      expect(createMany).not.toHaveBeenCalled()
    }
  })

  it('uses transaction delegates for batch inserts and cursor updates', async () => {
    const {
      prisma,
      createMany,
      bootstrapUpdate,
      transaction,
      transactionCreateMany,
      transactionBootstrapUpdate,
    } = buildPrismaMock({
      bangumi: [{ id: 3, cover: 'https://image.anitabi.cn/bangumi/3/cover.jpg' }],
      bsState: {
        id: 1,
        bangumiCursor: 2,
        pointCursor: null,
        bangumiCompleted: false,
        pointCompleted: false,
        totalEnumerated: 8,
      },
      transactionCreateManyCount: 2,
    })

    await advanceBootstrap(prisma, 10)

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transactionCreateMany).toHaveBeenCalledTimes(1)
    expect(transactionBootstrapUpdate).toHaveBeenCalledTimes(1)
    expect(createMany).not.toHaveBeenCalled()
    expect(bootstrapUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the transactional bootstrap update fails', async () => {
    const updateError = new Error('update failed')
    const { prisma, createMany, bootstrapUpdate, transaction, transactionCreateMany } = buildPrismaMock({
      bangumi: [{ id: 4, cover: 'https://image.anitabi.cn/bangumi/4/cover.jpg' }],
      bsState: {
        id: 1,
        bangumiCursor: 3,
        pointCursor: null,
        bangumiCompleted: false,
        pointCompleted: false,
        totalEnumerated: 9,
      },
      transactionCreateManyCount: 2,
      transactionUpdateError: updateError,
    })

    await expect(advanceBootstrap(prisma, 10)).rejects.toThrow(updateError)

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transactionCreateMany).toHaveBeenCalledTimes(1)
    expect(createMany).not.toHaveBeenCalled()
    expect(bootstrapUpdate).not.toHaveBeenCalled()
  })
})
