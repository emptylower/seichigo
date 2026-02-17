import { normalizeText } from '@/lib/anitabi/utils'

export type SourceBangumiSnapshot = {
  id: number
  title: string
  sourceModifiedMs: number | null
}

export type LocalBangumiSnapshot = {
  id: number
  title: string
  sourceModifiedMs: bigint | null
  expectedPoints: number
  importedPoints: number
}

export type AnitabiDiffSampleItem = {
  id: number
  title: string
  sourceModifiedMs: string | null
  localModifiedMs: string | null
  expectedPoints: number | null
  importedPoints: number | null
  missingPoints: number | null
}

export type AnitabiSyncDiffSummary = {
  sourceTotal: number
  localTotal: number
  needsSync: boolean
  recommendedMode: 'delta' | 'full'
  works: {
    sourceOnlyCount: number
    localOnlyCount: number
    modifiedCount: number
    pointGapCount: number
    syncCandidateCount: number
  }
  points: {
    expectedInLocalWorks: number
    importedInLocalWorks: number
    missingInLocalWorks: number
  }
  examples: {
    sourceOnly: AnitabiDiffSampleItem[]
    localOnly: AnitabiDiffSampleItem[]
    modified: AnitabiDiffSampleItem[]
    pointGap: AnitabiDiffSampleItem[]
  }
}

function normalizePointCount(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

function normalizeTitle(input: unknown, fallbackId: number): string {
  return normalizeText(input) || `#${fallbackId}`
}

function modifiedToString(value: number | bigint | null): string | null {
  if (value == null) return null
  return String(value)
}

function toSampleItem(input: {
  id: number
  title: string
  sourceModifiedMs: number | null
  localModifiedMs: bigint | null
  expectedPoints: number | null
  importedPoints: number | null
}): AnitabiDiffSampleItem {
  const expected = input.expectedPoints == null ? null : normalizePointCount(input.expectedPoints)
  const imported = input.importedPoints == null ? null : normalizePointCount(input.importedPoints)
  const missing =
    expected != null && imported != null ? Math.max(expected - imported, 0) : null

  return {
    id: input.id,
    title: normalizeTitle(input.title, input.id),
    sourceModifiedMs: modifiedToString(input.sourceModifiedMs),
    localModifiedMs: modifiedToString(input.localModifiedMs),
    expectedPoints: expected,
    importedPoints: imported,
    missingPoints: missing,
  }
}

export function buildAnitabiSyncDiffSummary(
  sourceRows: SourceBangumiSnapshot[],
  localRows: LocalBangumiSnapshot[],
  sampleLimit = 8
): AnitabiSyncDiffSummary {
  const limit = Math.max(1, Math.min(30, Math.floor(sampleLimit)))
  const sourceMap = new Map<number, SourceBangumiSnapshot>()
  const localMap = new Map<number, LocalBangumiSnapshot>()

  for (const row of sourceRows) {
    if (!Number.isFinite(row.id) || sourceMap.has(row.id)) continue
    sourceMap.set(row.id, {
      id: row.id,
      title: normalizeTitle(row.title, row.id),
      sourceModifiedMs:
        row.sourceModifiedMs == null || !Number.isFinite(row.sourceModifiedMs)
          ? null
          : Number(row.sourceModifiedMs),
    })
  }

  for (const row of localRows) {
    if (!Number.isFinite(row.id) || localMap.has(row.id)) continue
    localMap.set(row.id, {
      id: row.id,
      title: normalizeTitle(row.title, row.id),
      sourceModifiedMs: row.sourceModifiedMs == null ? null : BigInt(row.sourceModifiedMs),
      expectedPoints: normalizePointCount(row.expectedPoints),
      importedPoints: normalizePointCount(row.importedPoints),
    })
  }

  const sourceOnly: AnitabiDiffSampleItem[] = []
  const modified: AnitabiDiffSampleItem[] = []
  const pointGap: AnitabiDiffSampleItem[] = []

  let expectedInLocalWorks = 0
  let importedInLocalWorks = 0
  let missingInLocalWorks = 0

  const syncCandidateIds = new Set<number>()

  for (const source of sourceMap.values()) {
    const local = localMap.get(source.id)
    if (!local) {
      sourceOnly.push(
        toSampleItem({
          id: source.id,
          title: source.title,
          sourceModifiedMs: source.sourceModifiedMs,
          localModifiedMs: null,
          expectedPoints: null,
          importedPoints: null,
        })
      )
      syncCandidateIds.add(source.id)
      continue
    }

    expectedInLocalWorks += local.expectedPoints
    importedInLocalWorks += local.importedPoints
    const gap = Math.max(local.expectedPoints - local.importedPoints, 0)
    missingInLocalWorks += gap

    if (
      source.sourceModifiedMs != null &&
      (local.sourceModifiedMs == null || BigInt(source.sourceModifiedMs) !== local.sourceModifiedMs)
    ) {
      modified.push(
        toSampleItem({
          id: source.id,
          title: source.title,
          sourceModifiedMs: source.sourceModifiedMs,
          localModifiedMs: local.sourceModifiedMs,
          expectedPoints: local.expectedPoints,
          importedPoints: local.importedPoints,
        })
      )
      syncCandidateIds.add(source.id)
    }

    if (gap > 0) {
      pointGap.push(
        toSampleItem({
          id: source.id,
          title: source.title,
          sourceModifiedMs: source.sourceModifiedMs,
          localModifiedMs: local.sourceModifiedMs,
          expectedPoints: local.expectedPoints,
          importedPoints: local.importedPoints,
        })
      )
      syncCandidateIds.add(source.id)
    }
  }

  const localOnly: AnitabiDiffSampleItem[] = []
  for (const local of localMap.values()) {
    if (sourceMap.has(local.id)) continue
    localOnly.push(
      toSampleItem({
        id: local.id,
        title: local.title,
        sourceModifiedMs: null,
        localModifiedMs: local.sourceModifiedMs,
        expectedPoints: local.expectedPoints,
        importedPoints: local.importedPoints,
      })
    )
  }

  sourceOnly.sort((a, b) => a.id - b.id)
  localOnly.sort((a, b) => a.id - b.id)
  modified.sort((a, b) => a.id - b.id)
  pointGap.sort((a, b) => {
    const gapA = a.missingPoints || 0
    const gapB = b.missingPoints || 0
    if (gapA !== gapB) return gapB - gapA
    return a.id - b.id
  })

  const recommendedMode: 'delta' | 'full' = localOnly.length > 0 ? 'full' : 'delta'
  const needsSync =
    sourceOnly.length > 0 || modified.length > 0 || pointGap.length > 0 || localOnly.length > 0

  return {
    sourceTotal: sourceMap.size,
    localTotal: localMap.size,
    needsSync,
    recommendedMode,
    works: {
      sourceOnlyCount: sourceOnly.length,
      localOnlyCount: localOnly.length,
      modifiedCount: modified.length,
      pointGapCount: pointGap.length,
      syncCandidateCount: syncCandidateIds.size,
    },
    points: {
      expectedInLocalWorks,
      importedInLocalWorks,
      missingInLocalWorks,
    },
    examples: {
      sourceOnly: sourceOnly.slice(0, limit),
      localOnly: localOnly.slice(0, limit),
      modified: modified.slice(0, limit),
      pointGap: pointGap.slice(0, limit),
    },
  }
}
