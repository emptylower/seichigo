import type { PrismaClient } from '@prisma/client'
import {
  buildBangumiSourceContent,
  buildBangumiSourceHash,
  buildPointSourceContent,
  buildPointSourceHash,
  normalizeMapTargetLanguages,
  type MapTranslationEntityType,
  type MapTranslationTargetLanguage,
} from '@/lib/translation/mapSourceHash'

export type MapTaskEnqueueMode = 'missing' | 'stale' | 'all'

export type MapTaskBackfillCursor = string | null

type TaskCandidate = {
  entityType: MapTranslationEntityType
  entityId: string
  targetLanguage: MapTranslationTargetLanguage
  sourceHash: string
  reason: 'missing' | 'stale'
}

type EnqueueTaskCandidatesResult = {
  enqueued: number
  updated: number
}

export type MapTaskBackfillInput = {
  prisma: PrismaClient
  entityType: MapTranslationEntityType
  targetLanguages?: readonly string[] | null
  mode?: MapTaskEnqueueMode
  limit?: number
  cursor?: MapTaskBackfillCursor
}

export type MapTaskBackfillResult = {
  scanned: number
  enqueued: number
  updated: number
  nextCursor: string | null
  done: boolean
}

export type MapTaskEnqueueForBangumiIdsInput = {
  prisma: PrismaClient
  bangumiIds: number[]
  targetLanguages?: readonly string[] | null
  mode?: MapTaskEnqueueMode
}

export type MapTaskEnqueueForBangumiIdsResult = {
  scannedBangumi: number
  scannedPoint: number
  enqueued: number
  updated: number
}

function normalizeMode(input: string | null | undefined): MapTaskEnqueueMode {
  if (input === 'missing' || input === 'stale') return input
  return 'all'
}

function clampLimit(value: number | null | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Number(value)))
}

function shouldQueueByMode(mode: MapTaskEnqueueMode, opts: { hasTranslation: boolean; stale: boolean }): boolean {
  if (mode === 'missing') return !opts.hasTranslation
  if (mode === 'stale') return opts.hasTranslation && opts.stale
  return !opts.hasTranslation || opts.stale
}

async function enqueueTaskCandidates(prisma: PrismaClient, candidates: TaskCandidate[]): Promise<EnqueueTaskCandidatesResult> {
  if (candidates.length === 0) return { enqueued: 0, updated: 0 }

  const entityType = candidates[0]?.entityType
  if (!entityType) return { enqueued: 0, updated: 0 }

  const entityIds = Array.from(new Set(candidates.map((candidate) => candidate.entityId)))
  const targetLanguages = Array.from(new Set(candidates.map((candidate) => candidate.targetLanguage)))

  const existingRows = await prisma.translationTask.findMany({
    where: {
      entityType,
      entityId: { in: entityIds },
      targetLanguage: { in: targetLanguages },
    },
    select: {
      id: true,
      entityId: true,
      targetLanguage: true,
      status: true,
      sourceHash: true,
    },
  })

  const existingByKey = new Map(existingRows.map((row) => [`${row.entityId}:${row.targetLanguage}`, row]))
  const createRows: Array<{
    entityType: MapTranslationEntityType
    entityId: string
    targetLanguage: MapTranslationTargetLanguage
    sourceHash: string
    status: 'pending'
  }> = []
  const updateRows: Array<{ id: string; sourceHash: string }> = []
  let enqueued = 0
  let updated = 0

  for (const candidate of candidates) {
    const key = `${candidate.entityId}:${candidate.targetLanguage}`
    const existing = existingByKey.get(key)

    if (!existing) {
      createRows.push({
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        targetLanguage: candidate.targetLanguage,
        sourceHash: candidate.sourceHash,
        status: 'pending',
      })
      continue
    }

    const sourceHashChanged = String(existing.sourceHash || '') !== candidate.sourceHash
    // Keep failed/ready history when source text is unchanged.
    // Requeue is handled by execute(includeFailed=true) instead of force-resetting status here.
    const mustResetPending = sourceHashChanged

    if (!mustResetPending) continue

    updateRows.push({
      id: existing.id,
      sourceHash: candidate.sourceHash,
    })
  }

  if (createRows.length > 0) {
    const createMany = (prisma.translationTask as { createMany?: unknown }).createMany
    if (typeof createMany === 'function') {
      const result = await (
        createMany as (args: {
          data: typeof createRows
          skipDuplicates: boolean
        }) => Promise<{ count: number }>
      )({
        data: createRows,
        skipDuplicates: true,
      })
      enqueued += Number(result?.count || 0)
    } else {
      for (const row of createRows) {
        await prisma.translationTask.create({
          data: row,
        })
        enqueued += 1
      }
    }
  }

  for (const row of updateRows) {
    await prisma.translationTask.update({
      where: { id: row.id },
      data: {
        sourceHash: row.sourceHash,
        status: 'pending',
        sourceContent: null,
        draftContent: null,
        finalContent: null,
        error: null,
        updatedAt: new Date(),
      } as any,
    })
    updated += 1
  }

  return { enqueued, updated }
}

function buildBangumiCandidates(rows: Array<{
  id: number
  titleZh: string | null
  description: string | null
  city: string | null
  i18n: Array<{ language: string; sourceHash: string | null }>
}>,
mode: MapTaskEnqueueMode,
langs: MapTranslationTargetLanguage[]): TaskCandidate[] {
  const out: TaskCandidate[] = []

  for (const row of rows) {
    const sourceHash = buildBangumiSourceHash(row)
    const i18nByLang = new Map(row.i18n.map((item) => [item.language, item]))

    for (const lang of langs) {
      const translated = i18nByLang.get(lang)
      const hasTranslation = Boolean(translated)
      const stale = hasTranslation && String(translated?.sourceHash || '') !== sourceHash
      if (!shouldQueueByMode(mode, { hasTranslation, stale })) continue

      out.push({
        entityType: 'anitabi_bangumi',
        entityId: String(row.id),
        targetLanguage: lang,
        sourceHash,
        reason: hasTranslation ? 'stale' : 'missing',
      })
    }
  }

  return out
}

function buildPointCandidates(rows: Array<{
  id: string
  name: string
  nameZh: string | null
  mark: string | null
  i18n: Array<{ language: string; sourceHash: string | null }>
}>,
mode: MapTaskEnqueueMode,
langs: MapTranslationTargetLanguage[]): TaskCandidate[] {
  const out: TaskCandidate[] = []

  for (const row of rows) {
    const sourceHash = buildPointSourceHash(row)
    const i18nByLang = new Map(row.i18n.map((item) => [item.language, item]))

    for (const lang of langs) {
      const translated = i18nByLang.get(lang)
      const hasTranslation = Boolean(translated)
      const stale = hasTranslation && String(translated?.sourceHash || '') !== sourceHash
      if (!shouldQueueByMode(mode, { hasTranslation, stale })) continue

      out.push({
        entityType: 'anitabi_point',
        entityId: row.id,
        targetLanguage: lang,
        sourceHash,
        reason: hasTranslation ? 'stale' : 'missing',
      })
    }
  }

  return out
}

export async function enqueueMapTranslationTasksForBackfill(input: MapTaskBackfillInput): Promise<MapTaskBackfillResult> {
  const langs = normalizeMapTargetLanguages(input.targetLanguages)
  const mode = normalizeMode(input.mode)
  const limit = clampLimit(input.limit ?? null, 1000, 1, 5000)

  if (input.entityType === 'anitabi_bangumi') {
    const cursorId = Number.parseInt(String(input.cursor || ''), 10)
    const hasCursor = Number.isFinite(cursorId)

    const rows = await input.prisma.anitabiBangumi.findMany({
      where: {
        mapEnabled: true,
        ...(hasCursor ? { id: { gt: cursorId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: {
        id: true,
        titleZh: true,
        description: true,
        city: true,
        i18n: {
          where: { language: { in: langs } },
          select: {
            language: true,
            sourceHash: true,
          },
        },
      },
    })

    const candidates = buildBangumiCandidates(rows, mode, langs)
    const result = await enqueueTaskCandidates(input.prisma, candidates)
    const last = rows[rows.length - 1]

    return {
      scanned: rows.length,
      enqueued: result.enqueued,
      updated: result.updated,
      nextCursor: last ? String(last.id) : null,
      done: rows.length < limit,
    }
  }

  const cursor = String(input.cursor || '').trim()
  const rows = await input.prisma.anitabiPoint.findMany({
    where: {
      ...(cursor ? { id: { gt: cursor } } : {}),
      bangumi: {
        mapEnabled: true,
      },
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      name: true,
      nameZh: true,
      mark: true,
      i18n: {
        where: { language: { in: langs } },
        select: {
          language: true,
          sourceHash: true,
        },
      },
    },
  })

  const candidates = buildPointCandidates(rows, mode, langs)
  const result = await enqueueTaskCandidates(input.prisma, candidates)
  const last = rows[rows.length - 1]

  return {
    scanned: rows.length,
    enqueued: result.enqueued,
    updated: result.updated,
    nextCursor: last ? String(last.id) : null,
    done: rows.length < limit,
  }
}

export async function enqueueMapTranslationTasksForBangumiIds(
  input: MapTaskEnqueueForBangumiIdsInput
): Promise<MapTaskEnqueueForBangumiIdsResult> {
  const bangumiIds = Array.from(new Set(input.bangumiIds.filter((id) => Number.isFinite(id) && id > 0)))
  if (bangumiIds.length === 0) {
    return {
      scannedBangumi: 0,
      scannedPoint: 0,
      enqueued: 0,
      updated: 0,
    }
  }

  const langs = normalizeMapTargetLanguages(input.targetLanguages)
  const mode = normalizeMode(input.mode)

  const [bangumiRows, pointRows] = await Promise.all([
    input.prisma.anitabiBangumi.findMany({
      where: {
        id: { in: bangumiIds },
        mapEnabled: true,
      },
      select: {
        id: true,
        titleZh: true,
        description: true,
        city: true,
        i18n: {
          where: { language: { in: langs } },
          select: {
            language: true,
            sourceHash: true,
          },
        },
      },
    }),
    input.prisma.anitabiPoint.findMany({
      where: {
        bangumiId: { in: bangumiIds },
      },
      select: {
        id: true,
        name: true,
        nameZh: true,
        mark: true,
        i18n: {
          where: { language: { in: langs } },
          select: {
            language: true,
            sourceHash: true,
          },
        },
      },
    }),
  ])

  const bangumiCandidates = buildBangumiCandidates(bangumiRows, mode, langs)
  const pointCandidates = buildPointCandidates(pointRows, mode, langs)

  const [bangumiResult, pointResult] = await Promise.all([
    enqueueTaskCandidates(input.prisma, bangumiCandidates),
    enqueueTaskCandidates(input.prisma, pointCandidates),
  ])

  return {
    scannedBangumi: bangumiRows.length,
    scannedPoint: pointRows.length,
    enqueued: bangumiResult.enqueued + pointResult.enqueued,
    updated: bangumiResult.updated + pointResult.updated,
  }
}

export function buildMapSourceContentByEntity(input: {
  entityType: MapTranslationEntityType
  row: {
    titleZh?: string | null
    description?: string | null
    city?: string | null
    name?: string | null
    nameZh?: string | null
    mark?: string | null
  }
}): { sourceContent: Record<string, unknown>; sourceHash: string } {
  if (input.entityType === 'anitabi_bangumi') {
    const sourceContent = buildBangumiSourceContent({
      titleZh: input.row.titleZh,
      description: input.row.description,
      city: input.row.city,
    })
    return {
      sourceContent,
      sourceHash: buildBangumiSourceHash({
        titleZh: input.row.titleZh,
        description: input.row.description,
        city: input.row.city,
      }),
    }
  }

  const sourceContent = buildPointSourceContent({
    name: input.row.name,
    nameZh: input.row.nameZh,
    mark: input.row.mark,
  })

  return {
    sourceContent,
    sourceHash: buildPointSourceHash({
      name: input.row.name,
      nameZh: input.row.nameZh,
      mark: input.row.mark,
    }),
  }
}
