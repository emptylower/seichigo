import {
  enumerateBangumiCoverVariants,
  enumeratePointImageVariants,
} from '@/lib/anitabi/imageMirrorVariants'
import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'

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
    status: 'pending' | 'mirrored'
    mirroredAt?: Date
  }
  update: {
    canonicalUrl?: string
    r2Key?: string
    status?: 'pending' | 'mirrored'
    attempts?: number
    lastError?: string | null
    mirroredAt?: Date
  }
}

export type CronDeltaPrisma = {
  mapImageMirrorState: {
    findUnique(args: {
      where: {
        sourceType_sourceId_variant: {
          sourceType: string
          sourceId: string
          variant: string
        }
      }
    }): Promise<CursorRow | null>
    upsert(args: MirrorStateUpsertArgs): Promise<unknown>
  }
  anitabiBangumi: {
    findMany(args: {
      where: {
        updatedAt: { gt: Date }
        mapEnabled: true
        cover: { not: null }
      }
      select: { id: true; cover: true }
    }): Promise<BangumiRow[]>
  }
  anitabiPoint: {
    findMany(args: {
      where: {
        updatedAt: { gt: Date }
        image: { not: null }
      }
      select: { id: true; image: true }
    }): Promise<PointRow[]>
  }
}

async function enqueueVariants(
  prisma: CronDeltaPrisma,
  sourceType: 'bangumi-cover' | 'point-image',
  sourceId: string,
  variants: Array<{ label: string; url: string }>,
): Promise<number> {
  let enqueued = 0

  for (const variant of variants) {
    const r2Key = await computeMirrorKey(variant.url, 'image/jpeg')

    await prisma.mapImageMirrorState.upsert({
      where: {
        sourceType_sourceId_variant: {
          sourceType,
          sourceId,
          variant: variant.label,
        },
      },
      create: {
        sourceType,
        sourceId,
        variant: variant.label,
        canonicalUrl: variant.url,
        r2Key,
        status: 'pending',
      },
      update: {
        canonicalUrl: variant.url,
        r2Key,
        status: 'pending',
        attempts: 0,
        lastError: null,
      },
    })
    enqueued += 1
  }

  return enqueued
}

export async function cronDelta(prisma: CronDeltaPrisma): Promise<{ enqueued: number }> {
  const cursorRow = await prisma.mapImageMirrorState.findUnique({
    where: {
      sourceType_sourceId_variant: CURSOR_KEY,
    },
  })
  const cursorAt = cursorRow?.mirroredAt ?? new Date(0)
  const now = new Date()

  const bangumi = await prisma.anitabiBangumi.findMany({
    where: {
      updatedAt: { gt: cursorAt },
      mapEnabled: true,
      cover: { not: null },
    },
    select: { id: true, cover: true },
  })

  const points = await prisma.anitabiPoint.findMany({
    where: {
      updatedAt: { gt: cursorAt },
      image: { not: null },
    },
    select: { id: true, image: true },
  })

  let enqueued = 0

  for (const row of bangumi) {
    enqueued += await enqueueVariants(
      prisma,
      'bangumi-cover',
      String(row.id),
      enumerateBangumiCoverVariants(row.cover),
    )
  }

  for (const row of points) {
    enqueued += await enqueueVariants(
      prisma,
      'point-image',
      row.id,
      enumeratePointImageVariants(row.image),
    )
  }

  await prisma.mapImageMirrorState.upsert({
    where: {
      sourceType_sourceId_variant: CURSOR_KEY,
    },
    create: {
      ...CURSOR_KEY,
      canonicalUrl: 'cursor',
      r2Key: 'cursor',
      status: 'mirrored',
      mirroredAt: now,
    },
    update: {
      mirroredAt: now,
    },
  })

  return { enqueued }
}
