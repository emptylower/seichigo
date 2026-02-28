import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchAniListMetadata: vi.fn(),
}))

vi.mock('@/lib/anitabi/anilist', () => ({
  fetchAniListMetadata: (...args: any[]) => mocks.fetchAniListMetadata(...args),
}))

describe('AniList enrichment for cross-language search', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('titleJaRaw match returns romaji/english/synonyms', async () => {
    mocks.fetchAniListMetadata.mockResolvedValue({
      id: 12189,
      title: {
        romaji: 'Hyouka',
        english: 'Hyouka',
        native: '氷菓',
      },
      synonyms: ['Hyoka', 'Ice Cream'],
    })

    const { enrichBangumiWithAniList } = await import('@/lib/anitabi/enrichment')
    const result = await enrichBangumiWithAniList({
      titleJaRaw: '氷菓',
      titleZh: '冰菓',
    })

    expect(result).toEqual({
      anilistId: 12189,
      titleOriginal: '氷菓',
      titleRomaji: 'Hyouka',
      titleEnglish: 'Hyouka',
      aliases: ['Hyoka', 'Ice Cream'],
      anilistMatchConfidence: expect.any(Number),
    })
    expect(mocks.fetchAniListMetadata).toHaveBeenCalledWith('氷菓')
  })

  it('No match returns null fields without error', async () => {
    mocks.fetchAniListMetadata.mockResolvedValue(null)

    const { enrichBangumiWithAniList } = await import('@/lib/anitabi/enrichment')
    const result = await enrichBangumiWithAniList({
      titleJaRaw: 'Unknown Anime',
      titleZh: '未知动画',
    })

    expect(result).toEqual({
      anilistId: null,
      titleOriginal: null,
      titleRomaji: null,
      titleEnglish: null,
      aliases: [],
      anilistMatchConfidence: null,
    })
  })

  it('Rate limit (429) retry succeeds', async () => {
    // First call: rate limited
    mocks.fetchAniListMetadata.mockRejectedValueOnce(
      Object.assign(new Error('Rate limited'), { status: 429 })
    )
    // Second call: success
    mocks.fetchAniListMetadata.mockResolvedValueOnce({
      id: 12189,
      title: {
        romaji: 'Hyouka',
        english: 'Hyouka',
        native: '氷菓',
      },
      synonyms: [],
    })

    const { enrichBangumiWithAniList } = await import('@/lib/anitabi/enrichment')
    const result = await enrichBangumiWithAniList({
      titleJaRaw: '氷菓',
      titleZh: '冰菓',
    })

    expect(result.anilistId).toBe(12189)
    expect(result.titleRomaji).toBe('Hyouka')
    expect(mocks.fetchAniListMetadata).toHaveBeenCalledTimes(2)
  })

  it('Rate limit (429) max retries exceeded fails gracefully', async () => {
    mocks.fetchAniListMetadata.mockRejectedValue(
      Object.assign(new Error('Rate limited'), { status: 429 })
    )

    const { enrichBangumiWithAniList } = await import('@/lib/anitabi/enrichment')
    const result = await enrichBangumiWithAniList({
      titleJaRaw: '氷菓',
      titleZh: '冰菓',
    })

    // Should return null fields after max retries
    expect(result).toEqual({
      anilistId: null,
      titleOriginal: null,
      titleRomaji: null,
      titleEnglish: null,
      aliases: [],
      anilistMatchConfidence: null,
    })
  })

  it('Network error returns null fields without throwing', async () => {
    mocks.fetchAniListMetadata.mockRejectedValue(new Error('Network error'))

    const { enrichBangumiWithAniList } = await import('@/lib/anitabi/enrichment')
    const result = await enrichBangumiWithAniList({
      titleJaRaw: '氷菓',
      titleZh: '冰菓',
    })

    expect(result).toEqual({
      anilistId: null,
      titleOriginal: null,
      titleRomaji: null,
      titleEnglish: null,
      aliases: [],
      anilistMatchConfidence: null,
    })
  })

  it('Partial AniList data (missing english title) handled gracefully', async () => {
    mocks.fetchAniListMetadata.mockResolvedValue({
      id: 12189,
      title: {
        romaji: 'Hyouka',
        english: null,
        native: '氷菓',
      },
      synonyms: [],
    })

    const { enrichBangumiWithAniList } = await import('@/lib/anitabi/enrichment')
    const result = await enrichBangumiWithAniList({
      titleJaRaw: '氷菓',
      titleZh: '冰菓',
    })

    expect(result).toEqual({
      anilistId: 12189,
      titleOriginal: '氷菓',
      titleRomaji: 'Hyouka',
      titleEnglish: null,
      aliases: [],
      anilistMatchConfidence: expect.any(Number),
    })
  })

  it('Confidence score calculation based on title similarity', async () => {
    mocks.fetchAniListMetadata.mockResolvedValue({
      id: 12189,
      title: {
        romaji: 'Hyouka',
        english: 'Hyouka',
        native: '氷菓',
      },
      synonyms: [],
    })

    const { enrichBangumiWithAniList } = await import('@/lib/anitabi/enrichment')
    const result = await enrichBangumiWithAniList({
      titleJaRaw: '氷菓',
      titleZh: '冰菓',
    })

    // Exact native title match should have high confidence
    expect(result.anilistMatchConfidence).toBeGreaterThan(0.8)
    expect(result.anilistMatchConfidence).toBeLessThanOrEqual(1.0)
  })
})
