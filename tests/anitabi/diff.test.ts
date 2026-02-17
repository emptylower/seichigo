import { describe, expect, it } from 'vitest'
import { buildAnitabiSyncDiffSummary, type LocalBangumiSnapshot, type SourceBangumiSnapshot } from '@/lib/anitabi/sync/diff'

describe('anitabi sync diff summary', () => {
  it('builds source/local diff and point gaps', () => {
    const source: SourceBangumiSnapshot[] = [
      { id: 1, title: 'A', sourceModifiedMs: 100 },
      { id: 2, title: 'B', sourceModifiedMs: 250 },
      { id: 4, title: 'D', sourceModifiedMs: 400 },
    ]

    const local: LocalBangumiSnapshot[] = [
      { id: 1, title: 'A', sourceModifiedMs: BigInt(100), expectedPoints: 2, importedPoints: 2 },
      { id: 2, title: 'B', sourceModifiedMs: BigInt(200), expectedPoints: 5, importedPoints: 3 },
      { id: 3, title: 'C', sourceModifiedMs: BigInt(300), expectedPoints: 1, importedPoints: 1 },
    ]

    const diff = buildAnitabiSyncDiffSummary(source, local, 10)

    expect(diff.sourceTotal).toBe(3)
    expect(diff.localTotal).toBe(3)
    expect(diff.needsSync).toBe(true)
    expect(diff.recommendedMode).toBe('full')

    expect(diff.works.sourceOnlyCount).toBe(1)
    expect(diff.works.localOnlyCount).toBe(1)
    expect(diff.works.modifiedCount).toBe(1)
    expect(diff.works.pointGapCount).toBe(1)
    expect(diff.works.syncCandidateCount).toBe(2)

    expect(diff.points.expectedInLocalWorks).toBe(7)
    expect(diff.points.importedInLocalWorks).toBe(5)
    expect(diff.points.missingInLocalWorks).toBe(2)

    expect(diff.examples.sourceOnly[0]?.id).toBe(4)
    expect(diff.examples.localOnly[0]?.id).toBe(3)
    expect(diff.examples.modified[0]?.id).toBe(2)
    expect(diff.examples.pointGap[0]?.id).toBe(2)
  })

  it('recommends delta when only source-side updates exist', () => {
    const source: SourceBangumiSnapshot[] = [
      { id: 11, title: 'X', sourceModifiedMs: 10 },
      { id: 12, title: 'Y', sourceModifiedMs: 20 },
    ]

    const local: LocalBangumiSnapshot[] = [
      { id: 11, title: 'X', sourceModifiedMs: BigInt(10), expectedPoints: 1, importedPoints: 1 },
    ]

    const diff = buildAnitabiSyncDiffSummary(source, local, 10)

    expect(diff.recommendedMode).toBe('delta')
    expect(diff.works.sourceOnlyCount).toBe(1)
    expect(diff.works.localOnlyCount).toBe(0)
    expect(diff.works.syncCandidateCount).toBe(1)
  })
})
