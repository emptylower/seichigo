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
  canonicalUrl: string | null
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

type CursorTieBreakers = {
  bangumiLastId?: number
  pointLastId?: string
}

type CursorState = {
  mirroredAt: Date
  tieBreakers: CursorTieBreakers
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

type BangumiQueryWhere =
  & {
      updatedAt: { lte: Date }
      mapEnabled: true
      cover: { not: null }
      OR: Array<
        | { updatedAt: { gt: Date } }
        | { updatedAt: Date }
        | {
            updatedAt: Date
            id: { gt: number }
          }
      >
    }

type PointQueryWhere =
  & {
      updatedAt: { lte: Date }
      image: { not: null }
      OR: Array<
        | { updatedAt: { gt: Date } }
        | { updatedAt: Date }
        | {
            updatedAt: Date
            id: { gt: string }
          }
      >
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
        canonicalUrl: string
        mirroredAt: Date
      }
    }): Promise<unknown>
  }
  anitabiBangumi: {
    findMany(args: {
      where: BangumiQueryWhere
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }]
      take: number
      select: { id: true; cover: true; updatedAt: true }
    }): Promise<BangumiRow[]>
  }
  anitabiPoint: {
    findMany(args: {
      where: PointQueryWhere
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

type SourceObservedRow<TId extends number | string> = ObservedRow & {
  id: TId
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

function lastObservedRow<TId extends number | string>(
  rows: SourceObservedRow<TId>[],
): SourceObservedRow<TId> | null {
  if (rows.length === 0) {
    return null
  }

  return rows[rows.length - 1]
}

function parseCursorTieBreakers(raw: string | null | undefined): CursorTieBreakers {
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }

    const tieBreakers: CursorTieBreakers = {}
    if (
      'bangumiLastId' in parsed &&
      typeof parsed.bangumiLastId === 'number' &&
      Number.isFinite(parsed.bangumiLastId)
    ) {
      tieBreakers.bangumiLastId = parsed.bangumiLastId
    }
    if ('pointLastId' in parsed && typeof parsed.pointLastId === 'string' && parsed.pointLastId) {
      tieBreakers.pointLastId = parsed.pointLastId
    }

    return tieBreakers
  } catch {
    return {}
  }
}

function serializeCursorTieBreakers(tieBreakers: CursorTieBreakers): string {
  const serialized: CursorTieBreakers = {}

  if (tieBreakers.bangumiLastId !== undefined) {
    serialized.bangumiLastId = tieBreakers.bangumiLastId
  }
  if (tieBreakers.pointLastId !== undefined) {
    serialized.pointLastId = tieBreakers.pointLastId
  }

  return JSON.stringify(serialized)
}

function readCursorState(cursorRow: CursorRow | null): CursorState {
  return {
    mirroredAt: cursorRow?.mirroredAt ?? new Date(0),
    tieBreakers: parseCursorTieBreakers(cursorRow?.canonicalUrl),
  }
}

function buildBangumiWhere(
  cursorAt: Date,
  upperBound: Date,
  lastBangumiId: number | undefined,
): BangumiQueryWhere {
  const OR: BangumiQueryWhere['OR'] =
    lastBangumiId === undefined
      ? [{ updatedAt: { gt: cursorAt } }, { updatedAt: cursorAt }]
      : [
          { updatedAt: { gt: cursorAt } },
          {
            updatedAt: cursorAt,
            id: { gt: lastBangumiId },
          },
        ]

  return {
    updatedAt: { lte: upperBound },
    mapEnabled: true,
    cover: { not: null },
    OR,
  }
}

function buildPointWhere(
  cursorAt: Date,
  upperBound: Date,
  lastPointId: string | undefined,
): PointQueryWhere {
  const OR: PointQueryWhere['OR'] =
    lastPointId === undefined
      ? [{ updatedAt: { gt: cursorAt } }, { updatedAt: cursorAt }]
      : [
          { updatedAt: { gt: cursorAt } },
          {
            updatedAt: cursorAt,
            id: { gt: lastPointId },
          },
        ]

  return {
    updatedAt: { lte: upperBound },
    image: { not: null },
    OR,
  }
}

function lastObservedIdAtTimestamp<TId extends number | string>(
  rows: SourceObservedRow<TId>[],
  timestamp: Date,
): TId | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].updatedAt.getTime() === timestamp.getTime()) {
      return rows[index].id
    }
  }

  return undefined
}

function sameCursorState(left: CursorState, right: CursorState): boolean {
  return (
    left.mirroredAt.getTime() === right.mirroredAt.getTime() &&
    left.tieBreakers.bangumiLastId === right.tieBreakers.bangumiLastId &&
    left.tieBreakers.pointLastId === right.tieBreakers.pointLastId
  )
}

function nextCursorState(
  currentCursor: CursorState,
  upperBound: Date,
  bangumi: BangumiRow[],
  points: PointRow[],
  sourceBatchSize: number,
): CursorState | null {
  const bangumiLastSeen = lastObservedRow(bangumi)
  const pointLastSeen = lastObservedRow(points)

  if (!bangumiLastSeen && !pointLastSeen) {
    return null
  }

  const bangumiTruncated = bangumi.length === sourceBatchSize
  const pointsTruncated = points.length === sourceBatchSize
  const observedLastRows = [bangumiLastSeen, pointLastSeen].filter(
    (value): value is BangumiRow | PointRow => value !== null,
  )

  const nextCursorAt =
    !bangumiTruncated && !pointsTruncated
      ? observedLastRows.reduce((latest, current) =>
          current.updatedAt.getTime() > latest.updatedAt.getTime() ? current : latest,
        ).updatedAt
      : [
          bangumiLastSeen?.updatedAt ?? upperBound,
          pointLastSeen?.updatedAt ?? upperBound,
        ].reduce((earliest, current) =>
          current.getTime() < earliest.getTime() ? current : earliest,
        )

  const nextState: CursorState = {
    mirroredAt: nextCursorAt,
    tieBreakers: {
      bangumiLastId: lastObservedIdAtTimestamp(bangumi, nextCursorAt),
      pointLastId: lastObservedIdAtTimestamp(points, nextCursorAt),
    },
  }

  return sameCursorState(currentCursor, nextState) ? null : nextState
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
  const cursor = readCursorState(cursorRow)
  const upperBound = new Date()

  const bangumi = await prisma.anitabiBangumi.findMany({
    where: buildBangumiWhere(cursor.mirroredAt, upperBound, cursor.tieBreakers.bangumiLastId),
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: sourceBatchSize,
    select: { id: true, cover: true, updatedAt: true },
  })

  const points = await prisma.anitabiPoint.findMany({
    where: buildPointWhere(cursor.mirroredAt, upperBound, cursor.tieBreakers.pointLastId),
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

  const nextCursor = nextCursorState(cursor, upperBound, bangumi, points, sourceBatchSize)
  if (!nextCursor) {
    return { enqueued }
  }

  await prisma.mapImageMirrorState.upsert({
    where: {
      sourceType_sourceId_variant: CURSOR_KEY,
    },
    create: {
      ...CURSOR_KEY,
      canonicalUrl: serializeCursorTieBreakers(nextCursor.tieBreakers),
      r2Key: 'cursor',
      status: 'mirrored',
      mirroredAt: nextCursor.mirroredAt,
    },
    update: {
      canonicalUrl: serializeCursorTieBreakers(nextCursor.tieBreakers),
      mirroredAt: nextCursor.mirroredAt,
    },
  })

  return { enqueued }
}
