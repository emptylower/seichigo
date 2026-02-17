import { describe, expect, it } from 'vitest'
import { buildHotSnapshotFromAniListRows, resolveHotScore } from '@/lib/anitabi/hotRank'

describe('anitabi hot rank', () => {
  const snapshot = buildHotSnapshotFromAniListRows(
    [
      {
        title: {
          native: '葬送のフリーレン 第2期',
          romaji: 'Sousou no Frieren 2nd Season',
          english: "Frieren: Beyond Journey's End Season 2",
        },
        synonyms: ['Frieren Season 2'],
        trending: 95,
        popularity: 138261,
        favourites: 3600,
        averageScore: 89,
        startDate: { year: 2026 },
      },
      {
        title: {
          native: '地獄楽 第2期',
          romaji: 'Jigokuraku 2nd Season',
          english: 'Hells Paradise Season 2',
        },
        trending: 70,
        popularity: 110053,
        favourites: 1913,
        averageScore: 80,
        startDate: { year: 2026 },
      },
    ],
    {
      generatedAt: new Date('2026-02-17T00:00:00.000Z'),
      windowStart: new Date('2025-11-17T00:00:00.000Z'),
      windowDays: 90,
    }
  )

  it('matches exact titles and returns a positive hot score', () => {
    const score = resolveHotScore(snapshot, {
      titles: ['葬送のフリーレン 第2期'],
      years: [2026],
    })
    expect(score).toBeTypeOf('number')
    expect((score || 0) > 0).toBe(true)
  })

  it('allows base title match but gives lower confidence than exact title', () => {
    const exactScore = resolveHotScore(snapshot, {
      titles: ['葬送のフリーレン 第2期'],
      years: [2026],
    })
    const baseScore = resolveHotScore(snapshot, {
      titles: ['葬送のフリーレン'],
      years: [2026],
    })
    expect(exactScore).not.toBeNull()
    expect(baseScore).not.toBeNull()
    expect((exactScore || 0) > (baseScore || 0)).toBe(true)
  })

  it('penalizes year mismatches when title is the same', () => {
    const goodYear = resolveHotScore(snapshot, {
      titles: ['地獄楽 第2期'],
      years: [2026],
    })
    const wrongYear = resolveHotScore(snapshot, {
      titles: ['地獄楽 第2期'],
      years: [2022],
    })
    expect(goodYear).not.toBeNull()
    expect(wrongYear).not.toBeNull()
    expect((goodYear || 0) > (wrongYear || 0)).toBe(true)
  })

  it('returns null when no title can be matched', () => {
    const score = resolveHotScore(snapshot, {
      titles: ['完全不匹配的作品名'],
      years: [2026],
    })
    expect(score).toBeNull()
  })
})
