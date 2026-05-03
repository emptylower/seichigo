import { describe, expect, it, vi } from 'vitest'

import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'

import { cronDelta } from '../delta'

const CURSOR_KEY = { sourceType: '__cursor__', sourceId: 'delta', variant: '__' } as const

type CursorRow = {
  mirroredAt: Date | null
}

type BangumiRow = {
  id: number
  cover: string | null
}

type PointRow = {
  id: string
  image: string | null
}

function buildPrismaMock(opts: {
  cursorRow?: CursorRow | null
  bangumi?: BangumiRow[]
  points?: PointRow[]
}) {
  const findUnique = vi.fn().mockResolvedValue(opts.cursorRow ?? null)
  const upsert = vi.fn().mockResolvedValue({})
  const bangumiFindMany = vi.fn().mockResolvedValue(opts.bangumi ?? [])
  const pointFindMany = vi.fn().mockResolvedValue(opts.points ?? [])

  const prisma = {
    mapImageMirrorState: {
      findUnique,
      upsert,
    },
    anitabiBangumi: {
      findMany: bangumiFindMany,
    },
    anitabiPoint: {
      findMany: pointFindMany,
    },
  }

  return {
    prisma,
    findUnique,
    upsert,
    bangumiFindMany,
    pointFindMany,
  }
}

describe('cronDelta', () => {
  it('reads the cursor watermark, enqueues updated bangumi and point variants, and advances the cursor', async () => {
    vi.useFakeTimers()

    try {
      const cursorAt = new Date('2026-05-02T00:00:00Z')
      vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

      const { prisma, findUnique, upsert, bangumiFindMany, pointFindMany } = buildPrismaMock({
        cursorRow: { mirroredAt: cursorAt },
        bangumi: [{ id: 999, cover: 'https://image.anitabi.cn/bangumi/999/cover.jpg' }],
        points: [{ id: 'pn1', image: 'https://image.anitabi.cn/points/pn1.jpg' }],
      })

      await expect(cronDelta(prisma as never)).resolves.toEqual({ enqueued: 5 })

      expect(findUnique).toHaveBeenCalledWith({
        where: {
          sourceType_sourceId_variant: CURSOR_KEY,
        },
      })
      expect(bangumiFindMany).toHaveBeenCalledWith({
        where: {
          updatedAt: { gt: cursorAt },
          mapEnabled: true,
          cover: { not: null },
        },
        select: { id: true, cover: true },
      })
      expect(pointFindMany).toHaveBeenCalledWith({
        where: {
          updatedAt: { gt: cursorAt },
          image: { not: null },
        },
        select: { id: true, image: true },
      })
      expect(upsert).toHaveBeenCalledTimes(6)
      expect(upsert).toHaveBeenNthCalledWith(1, {
        where: {
          sourceType_sourceId_variant: {
            sourceType: 'bangumi-cover',
            sourceId: '999',
            variant: 'cover-l',
          },
        },
        create: {
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
        update: {
          canonicalUrl: 'https://image.anitabi.cn/bangumi/999/cover.jpg?plan=l',
          r2Key: await computeMirrorKey(
            'https://image.anitabi.cn/bangumi/999/cover.jpg?plan=l',
            'image/jpeg',
          ),
          status: 'pending',
          attempts: 0,
          lastError: null,
        },
      })
      expect(upsert).toHaveBeenNthCalledWith(2, {
        where: {
          sourceType_sourceId_variant: {
            sourceType: 'bangumi-cover',
            sourceId: '999',
            variant: 'cover-m',
          },
        },
        create: {
          sourceType: 'bangumi-cover',
          sourceId: '999',
          variant: 'cover-m',
          canonicalUrl: 'https://image.anitabi.cn/bangumi/999/cover.jpg',
          r2Key: await computeMirrorKey(
            'https://image.anitabi.cn/bangumi/999/cover.jpg',
            'image/jpeg',
          ),
          status: 'pending',
        },
        update: {
          canonicalUrl: 'https://image.anitabi.cn/bangumi/999/cover.jpg',
          r2Key: await computeMirrorKey(
            'https://image.anitabi.cn/bangumi/999/cover.jpg',
            'image/jpeg',
          ),
          status: 'pending',
          attempts: 0,
          lastError: null,
        },
      })
      expect(upsert).toHaveBeenNthCalledWith(3, {
        where: {
          sourceType_sourceId_variant: {
            sourceType: 'point-image',
            sourceId: 'pn1',
            variant: 'h160',
          },
        },
        create: {
          sourceType: 'point-image',
          sourceId: 'pn1',
          variant: 'h160',
          canonicalUrl: 'https://image.anitabi.cn/points/pn1.jpg?plan=h160',
          r2Key: await computeMirrorKey(
            'https://image.anitabi.cn/points/pn1.jpg?plan=h160',
            'image/jpeg',
          ),
          status: 'pending',
        },
        update: {
          canonicalUrl: 'https://image.anitabi.cn/points/pn1.jpg?plan=h160',
          r2Key: await computeMirrorKey(
            'https://image.anitabi.cn/points/pn1.jpg?plan=h160',
            'image/jpeg',
          ),
          status: 'pending',
          attempts: 0,
          lastError: null,
        },
      })
      expect(upsert).toHaveBeenNthCalledWith(4, {
        where: {
          sourceType_sourceId_variant: {
            sourceType: 'point-image',
            sourceId: 'pn1',
            variant: 'h320',
          },
        },
        create: {
          sourceType: 'point-image',
          sourceId: 'pn1',
          variant: 'h320',
          canonicalUrl: 'https://image.anitabi.cn/points/pn1.jpg?plan=h320',
          r2Key: await computeMirrorKey(
            'https://image.anitabi.cn/points/pn1.jpg?plan=h320',
            'image/jpeg',
          ),
          status: 'pending',
        },
        update: {
          canonicalUrl: 'https://image.anitabi.cn/points/pn1.jpg?plan=h320',
          r2Key: await computeMirrorKey(
            'https://image.anitabi.cn/points/pn1.jpg?plan=h320',
            'image/jpeg',
          ),
          status: 'pending',
          attempts: 0,
          lastError: null,
        },
      })
      expect(upsert).toHaveBeenNthCalledWith(5, {
        where: {
          sourceType_sourceId_variant: {
            sourceType: 'point-image',
            sourceId: 'pn1',
            variant: 'w640q80',
          },
        },
        create: {
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
        update: {
          canonicalUrl: 'https://image.anitabi.cn/points/pn1.jpg?q=80&w=640',
          r2Key: await computeMirrorKey(
            'https://image.anitabi.cn/points/pn1.jpg?q=80&w=640',
            'image/jpeg',
          ),
          status: 'pending',
          attempts: 0,
          lastError: null,
        },
      })
      expect(upsert).toHaveBeenNthCalledWith(6, {
        where: {
          sourceType_sourceId_variant: CURSOR_KEY,
        },
        create: {
          ...CURSOR_KEY,
          canonicalUrl: 'cursor',
          r2Key: 'cursor',
          status: 'mirrored',
          mirroredAt: new Date('2026-05-03T12:00:00Z'),
        },
        update: {
          mirroredAt: new Date('2026-05-03T12:00:00Z'),
        },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('falls back to the unix epoch when no cursor row exists and does not count the cursor row as work', async () => {
    vi.useFakeTimers()

    try {
      vi.setSystemTime(new Date('2026-05-03T13:00:00Z'))

      const { prisma, bangumiFindMany, pointFindMany, upsert } = buildPrismaMock({})

      await expect(cronDelta(prisma as never)).resolves.toEqual({ enqueued: 0 })

      expect(bangumiFindMany).toHaveBeenCalledWith({
        where: {
          updatedAt: { gt: new Date(0) },
          mapEnabled: true,
          cover: { not: null },
        },
        select: { id: true, cover: true },
      })
      expect(pointFindMany).toHaveBeenCalledWith({
        where: {
          updatedAt: { gt: new Date(0) },
          image: { not: null },
        },
        select: { id: true, image: true },
      })
      expect(upsert).toHaveBeenCalledTimes(1)
      expect(upsert).toHaveBeenCalledWith({
        where: {
          sourceType_sourceId_variant: CURSOR_KEY,
        },
        create: {
          ...CURSOR_KEY,
          canonicalUrl: 'cursor',
          r2Key: 'cursor',
          status: 'mirrored',
          mirroredAt: new Date('2026-05-03T13:00:00Z'),
        },
        update: {
          mirroredAt: new Date('2026-05-03T13:00:00Z'),
        },
      })
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})
