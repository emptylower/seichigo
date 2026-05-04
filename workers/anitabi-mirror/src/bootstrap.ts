import type { PrismaClient } from '@prisma/client'

import {
  enumerateBangumiCoverVariants,
  enumeratePointImageVariants,
} from '@/lib/anitabi/imageMirrorVariants'
import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'

type BootstrapRecord = {
  id: number
  bangumiCursor: number | null
  pointCursor: string | null
  bangumiCompleted: boolean
  pointCompleted: boolean
  totalEnumerated: number
}

type BangumiRow = {
  id: number
  cover: string | null
}

type PointRow = {
  id: string
  image: string | null
}

type MirrorStateCreateManyRow = {
  sourceType: string
  sourceId: string
  variant: string
  canonicalUrl: string
  r2Key: string
  status: 'pending'
}

type BootstrapUpdateData = {
  bangumiCursor?: number
  pointCursor?: string
  bangumiCompleted?: boolean
  pointCompleted?: boolean
  totalEnumerated?: number | { increment: number }
  completedAt?: Date
  lastAdvanceAt?: Date
}

export type AdvanceBootstrapTransactionPrisma = {
  mapImageMirrorBootstrap: {
    update(args: {
      where: { id: number }
      data: BootstrapUpdateData
    }): Promise<unknown>
  }
  mapImageMirrorState: Pick<PrismaClient['mapImageMirrorState'], 'createMany'>
}

export type AdvanceBootstrapPrisma = {
  $transaction<T>(callback: (tx: AdvanceBootstrapTransactionPrisma) => Promise<T>): Promise<T>
  mapImageMirrorBootstrap: {
    upsert(args: {
      where: { id: number }
      create: { id: number; startedAt: Date }
      update: {}
    }): Promise<BootstrapRecord>
    update(args: {
      where: { id: number }
      data: BootstrapUpdateData
    }): Promise<unknown>
  }
  anitabiBangumi: {
    findMany(args: {
      where: { mapEnabled: true; cover: { not: null }; id?: { gt: number } }
      orderBy: { id: 'asc' }
      take: number
      select: { id: true; cover: true }
    }): Promise<BangumiRow[]>
  }
  anitabiPoint: {
    findMany(args: {
      where: { image: { not: null }; id?: { gt: string } }
      orderBy: { id: 'asc' }
      take: number
      select: { id: true; image: true }
    }): Promise<PointRow[]>
  }
  mapImageMirrorState: Pick<PrismaClient['mapImageMirrorState'], 'createMany'>
}

async function buildMirrorStateRows(
  sourceType: 'bangumi-cover' | 'point-image',
  sourceId: string,
  variants: Array<{ label: string; url: string }>,
): Promise<MirrorStateCreateManyRow[]> {
  return Promise.all(
    variants.map(async (variant) => ({
      sourceType,
      sourceId,
      variant: variant.label,
      canonicalUrl: variant.url,
      r2Key: await computeMirrorKey(variant.url, 'image/jpeg'),
      status: 'pending',
    })),
  )
}

async function createMirrorStates(
  prisma: Pick<AdvanceBootstrapTransactionPrisma, 'mapImageMirrorState'>,
  rows: MirrorStateCreateManyRow[],
): Promise<number> {
  if (rows.length === 0) {
    return 0
  }

  const result = await prisma.mapImageMirrorState.createMany({
    data: rows,
    skipDuplicates: true,
  })

  return result.count
}

export async function advanceBootstrap(
  prisma: AdvanceBootstrapPrisma,
  chunkSize: number,
): Promise<void> {
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new RangeError('chunkSize must be a finite positive number')
  }

  const now = new Date()
  const bootstrap = await prisma.mapImageMirrorBootstrap.upsert({
    where: { id: 1 },
    create: { id: 1, startedAt: now },
    update: {},
  })

  if (!bootstrap.bangumiCompleted) {
    const batch = await prisma.anitabiBangumi.findMany({
      where: {
        ...(bootstrap.bangumiCursor != null ? { id: { gt: bootstrap.bangumiCursor } } : {}),
        mapEnabled: true,
        cover: { not: null },
      },
      orderBy: { id: 'asc' },
      take: chunkSize,
      select: { id: true, cover: true },
    })

    if (batch.length === 0) {
      await prisma.mapImageMirrorBootstrap.update({
        where: { id: 1 },
        data: {
          bangumiCompleted: true,
          lastAdvanceAt: now,
        },
      })
      return
    }

    const rows = (
      await Promise.all(
        batch.map((bangumi) =>
          buildMirrorStateRows(
            'bangumi-cover',
            String(bangumi.id),
            enumerateBangumiCoverVariants(bangumi.cover),
          ),
        ),
      )
    ).flat()

    await prisma.$transaction(async (tx) => {
      const created = await createMirrorStates(tx, rows)

      await tx.mapImageMirrorBootstrap.update({
        where: { id: 1 },
        data: {
          bangumiCursor: batch[batch.length - 1].id,
          totalEnumerated: { increment: created },
          lastAdvanceAt: now,
        },
      })
    })
    return
  }

  if (bootstrap.pointCompleted) {
    return
  }

  const batch = await prisma.anitabiPoint.findMany({
    where: {
      ...(bootstrap.pointCursor != null ? { id: { gt: bootstrap.pointCursor } } : {}),
      image: { not: null },
    },
    orderBy: { id: 'asc' },
    take: chunkSize,
    select: { id: true, image: true },
  })

  if (batch.length === 0) {
    await prisma.mapImageMirrorBootstrap.update({
      where: { id: 1 },
      data: {
        pointCompleted: true,
        completedAt: now,
        lastAdvanceAt: now,
      },
    })
    return
  }

  const rows = (
    await Promise.all(
      batch.map((point) =>
        buildMirrorStateRows('point-image', point.id, enumeratePointImageVariants(point.image)),
      ),
    )
  ).flat()

  await prisma.$transaction(async (tx) => {
    const created = await createMirrorStates(tx, rows)

    await tx.mapImageMirrorBootstrap.update({
      where: { id: 1 },
      data: {
        pointCursor: batch[batch.length - 1].id,
        totalEnumerated: { increment: created },
        lastAdvanceAt: now,
      },
    })
  })
}
