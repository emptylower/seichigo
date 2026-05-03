import { describe, expect, it, vi } from 'vitest'

import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'
import { advanceBootstrap } from '../bootstrap'

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
}) {
  const stateUpserts: Array<Record<string, unknown>> = []
  const bootstrapUpdate = vi.fn().mockImplementation(async ({ data }: { data: object }) => ({
    ...opts.bsState,
    ...data,
  }))

  const prisma = {
    mapImageMirrorBootstrap: {
      upsert: vi.fn().mockResolvedValue(opts.bsState),
      update: bootstrapUpdate,
    },
    anitabiBangumi: {
      findMany: vi.fn().mockResolvedValue(opts.bangumi ?? []),
    },
    anitabiPoint: {
      findMany: vi.fn().mockResolvedValue(opts.points ?? []),
    },
    mapImageMirrorState: {
      upsert: vi.fn().mockImplementation(async (args: Record<string, unknown>) => {
        stateUpserts.push(args)
        return {}
      }),
    },
  }

  return {
    prisma,
    stateUpserts,
  }
}

describe('advanceBootstrap', () => {
  it('enumerates bangumi cover variants and advances the bangumi cursor', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

      const { prisma, stateUpserts } = buildPrismaMock({
        bangumi: [{ id: 1, cover: 'https://image.anitabi.cn/bangumi/1/cover.jpg' }],
        bsState: {
          id: 1,
          bangumiCursor: null,
          pointCursor: null,
          bangumiCompleted: false,
          pointCompleted: false,
          totalEnumerated: 0,
        },
      })

      await advanceBootstrap(prisma as never, 100)

      expect(prisma.mapImageMirrorBootstrap.upsert).toHaveBeenCalledWith({
        where: { id: 1 },
        create: { id: 1, startedAt: new Date('2026-05-03T12:00:00Z') },
        update: {},
      })
      expect(prisma.anitabiBangumi.findMany).toHaveBeenCalledWith({
        where: { mapEnabled: true, cover: { not: null } },
        orderBy: { id: 'asc' },
        take: 100,
        select: { id: true, cover: true },
      })
      expect(prisma.anitabiPoint.findMany).not.toHaveBeenCalled()
      expect(stateUpserts).toHaveLength(2)
      expect(stateUpserts).toEqual([
        {
          where: {
            sourceType_sourceId_variant: {
              sourceType: 'bangumi-cover',
              sourceId: '1',
              variant: 'cover-l',
            },
          },
          create: {
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
          update: {},
        },
        {
          where: {
            sourceType_sourceId_variant: {
              sourceType: 'bangumi-cover',
              sourceId: '1',
              variant: 'cover-m',
            },
          },
          create: {
            sourceType: 'bangumi-cover',
            sourceId: '1',
            variant: 'cover-m',
            canonicalUrl: 'https://image.anitabi.cn/bangumi/1/cover.jpg',
            r2Key: await computeMirrorKey('https://image.anitabi.cn/bangumi/1/cover.jpg', 'image/jpeg'),
            status: 'pending',
          },
          update: {},
        },
      ])
      expect(prisma.mapImageMirrorBootstrap.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          bangumiCursor: 1,
          totalEnumerated: 2,
          lastAdvanceAt: new Date('2026-05-03T12:00:00Z'),
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

      const { prisma, stateUpserts } = buildPrismaMock({
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

      await advanceBootstrap(prisma as never, 100)

      expect(prisma.anitabiBangumi.findMany).toHaveBeenCalledWith({
        where: { id: { gt: 99 }, mapEnabled: true, cover: { not: null } },
        orderBy: { id: 'asc' },
        take: 100,
        select: { id: true, cover: true },
      })
      expect(prisma.anitabiPoint.findMany).not.toHaveBeenCalled()
      expect(stateUpserts).toHaveLength(0)
      expect(prisma.mapImageMirrorBootstrap.update).toHaveBeenCalledWith({
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

      const { prisma, stateUpserts } = buildPrismaMock({
        points: [{ id: 'pt-1', image: 'https://image.anitabi.cn/points/pt-1.jpg' }],
        bsState: {
          id: 1,
          bangumiCursor: 123,
          pointCursor: null,
          bangumiCompleted: true,
          pointCompleted: false,
          totalEnumerated: 7,
        },
      })

      await advanceBootstrap(prisma as never, 50)

      expect(prisma.anitabiBangumi.findMany).not.toHaveBeenCalled()
      expect(prisma.anitabiPoint.findMany).toHaveBeenCalledWith({
        where: { image: { not: null } },
        orderBy: { id: 'asc' },
        take: 50,
        select: { id: true, image: true },
      })
      expect(stateUpserts).toHaveLength(3)
      expect(stateUpserts.map((entry) => entry.create)).toEqual([
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
      ])
      expect(stateUpserts.every((entry) => entry.update && Object.keys(entry.update as object).length === 0)).toBe(
        true,
      )
      expect(prisma.mapImageMirrorBootstrap.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          pointCursor: 'pt-1',
          totalEnumerated: 10,
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

      const { prisma, stateUpserts } = buildPrismaMock({
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

      await advanceBootstrap(prisma as never, 25)

      expect(prisma.anitabiPoint.findMany).toHaveBeenCalledWith({
        where: { id: { gt: 'pt-99' }, image: { not: null } },
        orderBy: { id: 'asc' },
        take: 25,
        select: { id: true, image: true },
      })
      expect(stateUpserts).toHaveLength(0)
      expect(prisma.mapImageMirrorBootstrap.update).toHaveBeenCalledWith({
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
})
