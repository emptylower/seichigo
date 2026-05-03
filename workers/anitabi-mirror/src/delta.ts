import {
  enumerateBangumiCoverVariants,
  enumeratePointImageVariants,
} from '@/lib/anitabi/imageMirrorVariants'
import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'

const CURSOR_KEY = { sourceType: '__cursor__', sourceId: 'delta', variant: '__' } as const
const DEFAULT_SOURCE_BATCH_SIZE = 100
const REQUEUEABLE_STATUSES = ['mirrored', 'failed', 'skipped_404'] as const

type CursorRow = {
  mirroredAt: Date | null
}

type BangumiRow = {
  id: number
  cover: string | null
  updatedAt: Date
}

type PointRow = {
  id: string
  image: string | null
  updatedAt: Date
}

type MirrorStateVariantKey = {
  sourceType: string
  sourceId: string
  variant: string
}

type MirrorStateUniqueWhere = {
  sourceType_sourceId_variant: MirrorStateVariantKey
}

type MirrorStateCreateData = MirrorStateVariantKey & {
  canonicalUrl: string
  r2Key: string
  status: 'pending'
}

type MirrorStateUpdateManyWhere =
  | (MirrorStateVariantKey & {
      status: { in: Array<(typeof REQUEUEABLE_STATUSES)[number]> }
    })
  | (MirrorStateVariantKey & {
      status: 'pending'
    })

type MirrorStateUpdateManyData = {
  canonicalUrl?: string
  r2Key?: string
  status?: 'pending'
  attempts?: number
  lastError?: string | null
  mirroredAt?: Date | null
  lastAttemptAt?: Date | null
  contentBytes?: number | null
}

type MirrorStateUpdateManyResult = {
  count: number
}

export type CronDeltaPrisma = {
  mapImageMirrorState: {
    findUnique(args: {
      where: MirrorStateUniqueWhere
    }): Promise<CursorRow | null>
    create(args: {
      data: MirrorStateCreateData
    }): Promise<unknown>
    updateMany(args: {
      where: MirrorStateUpdateManyWhere
      data: MirrorStateUpdateManyData
    }): Promise<MirrorStateUpdateManyResult>
    upsert(args: {
      where: MirrorStateUniqueWhere
      create: MirrorStateVariantKey & {
        canonicalUrl: string
        r2Key: string
        status: 'mirrored'
        mirroredAt: Date
      }
      update: {
        mirroredAt: Date
      }
    }): Promise<unknown>
  }
  anitabiBangumi: {
    findMany(args: {
      where: {
        updatedAt: { gt: Date; lte: Date }
        mapEnabled: true
        cover: { not: null }
      }
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }]
      take: number
      select: { id: true; cover: true; updatedAt: true }
    }): Promise<BangumiRow[]>
  }
  anitabiPoint: {
    findMany(args: {
      where: {
        updatedAt: { gt: Date; lte: Date }
        image: { not: null }
      }
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }]
      take: number
      select: { id: true; image: true; updatedAt: true }
    }): Promise<PointRow[]>
  }
}

export type CronDeltaOptions = {
  sourceBatchSize?: number
}

type ObservedRow = {
  updatedAt: Date
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

function lastObservedAt(rows: ObservedRow[]): Date | null {
  if (rows.length === 0) {
    return null
  }

  return rows[rows.length - 1].updatedAt
}

function safeSourceWatermark(rows: ObservedRow[], cursorAt: Date, limit: number): Date | null {
  const lastSeenAt = lastObservedAt(rows)
  if (!lastSeenAt) {
    return null
  }

  if (rows.length < limit) {
    return lastSeenAt
  }

  for (let index = rows.length - 2; index >= 0; index -= 1) {
    if (rows[index].updatedAt.getTime() !== lastSeenAt.getTime()) {
      return rows[index].updatedAt
    }
  }

  return cursorAt
}

function nextCursorWatermark(
  cursorAt: Date,
  bangumi: BangumiRow[],
  points: PointRow[],
  sourceBatchSize: number,
): Date | null {
  const bangumiLastSeenAt = lastObservedAt(bangumi)
  const pointLastSeenAt = lastObservedAt(points)

  if (!bangumiLastSeenAt && !pointLastSeenAt) {
    return null
  }

  const bangumiTruncated = bangumi.length === sourceBatchSize
  const pointsTruncated = points.length === sourceBatchSize

  if (!bangumiTruncated && !pointsTruncated) {
    const exactWatermark = [bangumiLastSeenAt, pointLastSeenAt]
      .filter((value): value is Date => value !== null)
      .reduce((latest, current) => (current.getTime() > latest.getTime() ? current : latest))

    return exactWatermark.getTime() > cursorAt.getTime() ? exactWatermark : null
  }

  const constrainedWatermark = [
    bangumiLastSeenAt
      ? safeSourceWatermark(bangumi, cursorAt, sourceBatchSize) ?? cursorAt
      : null,
    pointLastSeenAt ? safeSourceWatermark(points, cursorAt, sourceBatchSize) ?? cursorAt : null,
  ]
    .filter((value): value is Date => value !== null)
    .reduce((earliest, current) => (current.getTime() < earliest.getTime() ? current : earliest))

  return constrainedWatermark.getTime() > cursorAt.getTime() ? constrainedWatermark : null
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
    const variantKey = {
      sourceType,
      sourceId,
      variant: variant.label,
    }

    try {
      await prisma.mapImageMirrorState.create({
        data: {
          ...variantKey,
          canonicalUrl: variant.url,
          r2Key,
          status: 'pending',
        },
      })
      enqueued += 1
      continue
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error
      }
    }

    const requeued = await prisma.mapImageMirrorState.updateMany({
      where: {
        ...variantKey,
        status: { in: [...REQUEUEABLE_STATUSES] },
      },
      data: {
        canonicalUrl: variant.url,
        r2Key,
        status: 'pending',
        attempts: 0,
        lastError: null,
        mirroredAt: null,
        lastAttemptAt: null,
        contentBytes: null,
      },
    })
    if (requeued.count === 1) {
      enqueued += 1
      continue
    }

    await prisma.mapImageMirrorState.updateMany({
      where: {
        ...variantKey,
        status: 'pending',
      },
      data: {
        canonicalUrl: variant.url,
        r2Key,
        attempts: 0,
        lastError: null,
        mirroredAt: null,
        lastAttemptAt: null,
        contentBytes: null,
      },
    })
  }

  return enqueued
}

export async function cronDelta(
  prisma: CronDeltaPrisma,
  opts: CronDeltaOptions = {},
): Promise<{ enqueued: number }> {
  const sourceBatchSize = opts.sourceBatchSize ?? DEFAULT_SOURCE_BATCH_SIZE
  if (!Number.isFinite(sourceBatchSize) || sourceBatchSize <= 0) {
    throw new RangeError('sourceBatchSize must be a finite positive number')
  }

  const cursorRow = await prisma.mapImageMirrorState.findUnique({
    where: {
      sourceType_sourceId_variant: CURSOR_KEY,
    },
  })
  const cursorAt = cursorRow?.mirroredAt ?? new Date(0)
  const upperBound = new Date()

  const bangumi = await prisma.anitabiBangumi.findMany({
    where: {
      updatedAt: { gt: cursorAt, lte: upperBound },
      mapEnabled: true,
      cover: { not: null },
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: sourceBatchSize,
    select: { id: true, cover: true, updatedAt: true },
  })

  const points = await prisma.anitabiPoint.findMany({
    where: {
      updatedAt: { gt: cursorAt, lte: upperBound },
      image: { not: null },
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: sourceBatchSize,
    select: { id: true, image: true, updatedAt: true },
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

  const nextCursorAt = nextCursorWatermark(cursorAt, bangumi, points, sourceBatchSize)
  if (!nextCursorAt) {
    return { enqueued }
  }

  // The cursor only stores a timestamp, so a full batch must stop at the last
  // fully covered timestamp to avoid skipping rows that share the truncated tail.
  await prisma.mapImageMirrorState.upsert({
    where: {
      sourceType_sourceId_variant: CURSOR_KEY,
    },
    create: {
      ...CURSOR_KEY,
      canonicalUrl: 'cursor',
      r2Key: 'cursor',
      status: 'mirrored',
      mirroredAt: nextCursorAt,
    },
    update: {
      mirroredAt: nextCursorAt,
    },
  })

  return { enqueued }
}
