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

type MirrorStateUpsertArgs = {
  where: {
    sourceType_sourceId_variant: {
      sourceType: string
      sourceId: string
      variant: string
    }
  }
  create: {
    sourceType: string
    sourceId: string
    variant: string
    canonicalUrl: string
    r2Key: string
    status: 'pending'
  }
  update: {}
}

export type AdvanceBootstrapPrisma = {
  mapImageMirrorBootstrap: {
    upsert(args: {
      where: { id: number }
      create: { id: number; startedAt: Date }
      update: {}
    }): Promise<BootstrapRecord>
    update(args: {
      where: { id: number }
      data: {
        bangumiCursor?: number
        pointCursor?: string
        bangumiCompleted?: boolean
        pointCompleted?: boolean
        totalEnumerated?: number
        completedAt?: Date
        lastAdvanceAt?: Date
      }
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
  mapImageMirrorState: Pick<PrismaClient['mapImageMirrorState'], 'upsert'>
}

async function upsertMirrorState(
  prisma: AdvanceBootstrapPrisma,
  args: MirrorStateUpsertArgs,
): Promise<void> {
  await prisma.mapImageMirrorState.upsert(args)
}

export async function advanceBootstrap(
  prisma: AdvanceBootstrapPrisma,
  chunkSize: number,
): Promise<void> {
  const now = new Date()
  const bootstrap = await prisma.mapImageMirrorBootstrap.upsert({
    where: { id: 1 },
    create: { id: 1, startedAt: now },
    update: {},
  })

  let totalEnumerated = bootstrap.totalEnumerated ?? 0

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

    for (const bangumi of batch) {
      for (const variant of enumerateBangumiCoverVariants(bangumi.cover)) {
        await upsertMirrorState(prisma, {
          where: {
            sourceType_sourceId_variant: {
              sourceType: 'bangumi-cover',
              sourceId: String(bangumi.id),
              variant: variant.label,
            },
          },
          create: {
            sourceType: 'bangumi-cover',
            sourceId: String(bangumi.id),
            variant: variant.label,
            canonicalUrl: variant.url,
            r2Key: await computeMirrorKey(variant.url, 'image/jpeg'),
            status: 'pending',
          },
          update: {},
        })
        totalEnumerated += 1
      }
    }

    await prisma.mapImageMirrorBootstrap.update({
      where: { id: 1 },
      data: {
        bangumiCursor: batch[batch.length - 1].id,
        totalEnumerated,
        lastAdvanceAt: now,
      },
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

  for (const point of batch) {
    for (const variant of enumeratePointImageVariants(point.image)) {
      await upsertMirrorState(prisma, {
        where: {
          sourceType_sourceId_variant: {
            sourceType: 'point-image',
            sourceId: point.id,
            variant: variant.label,
          },
        },
        create: {
          sourceType: 'point-image',
          sourceId: point.id,
          variant: variant.label,
          canonicalUrl: variant.url,
          r2Key: await computeMirrorKey(variant.url, 'image/jpeg'),
          status: 'pending',
        },
        update: {},
      })
      totalEnumerated += 1
    }
  }

  await prisma.mapImageMirrorBootstrap.update({
    where: { id: 1 },
    data: {
      pointCursor: batch[batch.length - 1].id,
      totalEnumerated,
      lastAdvanceAt: now,
    },
  })
}
