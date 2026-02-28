import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  translateText: vi.fn(),
  searchDataset: vi.fn(),
}))

vi.mock('@/lib/translation/gemini', () => ({
  translateText: (...args: any[]) => mocks.translateText(...args),
}))

vi.mock('@/lib/anitabi/read', () => ({
  searchDataset: (...args: any[]) => mocks.searchDataset(...args),
}))

import { translateSearchQuery, searchWithFallback } from '@/lib/anitabi/searchCache'

function emptyResults() {
  return { bangumi: [], points: [], cities: [] }
}

function makeBangumi(id: number, title: string) {
  return {
    id,
    title,
    titleOriginal: title,
    image: null,
    city: 'Tokyo',
    pointsLength: 0,
    imagesLength: 0,
    latlng: null,
    cn: null,
  }
}

function makePoint(id: number, name: string) {
  return {
    id,
    name,
    nameZh: name,
    latlng: [35.0, 139.0] as [number, number],
    image: null,
    ep: null,
    s: null,
    bangumiId: 1,
  }
}

function createPrismaMock() {
  return {
    searchQueryCache: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  }
}

describe('translateSearchQuery', () => {
  let prisma: ReturnType<typeof createPrismaMock>

  beforeEach(() => {
    vi.resetAllMocks()
    prisma = createPrismaMock()
  })

  it('Cache hit returns cached translations without calling Gemini', async () => {
    prisma.searchQueryCache.findUnique.mockResolvedValue({
      queryText: 'your name',
      translatedZh: '你的名字',
      translatedEn: 'Your Name',
      translatedJa: '君の名は',
      createdAt: new Date(), // Fresh
    })

    const result = await translateSearchQuery(prisma as any, 'Your Name', ['zh', 'en', 'ja'])

    expect(result.zh).toBe('你的名字')
    expect(result.en).toBe('Your Name')
    expect(result.ja).toBe('君の名は')
    expect(mocks.translateText).not.toHaveBeenCalled()
    expect(prisma.searchQueryCache.upsert).not.toHaveBeenCalled()
  })

  it('Cache miss calls Gemini and writes cache', async () => {
    prisma.searchQueryCache.findUnique.mockResolvedValue(null)
    prisma.searchQueryCache.upsert.mockResolvedValue({})
    mocks.translateText
      .mockResolvedValueOnce('你的名字')
      .mockResolvedValueOnce('Your Name')
      .mockResolvedValueOnce('君の名は')

    const result = await translateSearchQuery(prisma as any, 'Your Name', ['zh', 'en', 'ja'])

    expect(result.zh).toBe('你的名字')
    expect(result.en).toBe('Your Name')
    expect(result.ja).toBe('君の名は')
    expect(mocks.translateText).toHaveBeenCalledTimes(3)
    expect(prisma.searchQueryCache.upsert).toHaveBeenCalledOnce()
    expect(prisma.searchQueryCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { queryText: 'your name' },
        create: expect.objectContaining({
          translatedZh: '你的名字',
          translatedEn: 'Your Name',
          translatedJa: '君の名は',
        }),
      })
    )
  })

  it('Expired cache triggers re-translation', async () => {
    const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) // 8 days ago
    prisma.searchQueryCache.findUnique.mockResolvedValue({
      queryText: 'your name',
      translatedZh: '旧翻译',
      translatedEn: 'Old Translation',
      translatedJa: '古い翻訳',
      createdAt: expired,
    })
    prisma.searchQueryCache.upsert.mockResolvedValue({})
    mocks.translateText
      .mockResolvedValueOnce('你的名字')
      .mockResolvedValueOnce('Your Name')
      .mockResolvedValueOnce('君の名は')

    const result = await translateSearchQuery(prisma as any, 'Your Name', ['zh', 'en', 'ja'])

    expect(result.zh).toBe('你的名字')
    expect(mocks.translateText).toHaveBeenCalledTimes(3)
    expect(prisma.searchQueryCache.upsert).toHaveBeenCalledOnce()
  })

  it('Gemini failure falls back to original query', async () => {
    prisma.searchQueryCache.findUnique.mockResolvedValue(null)
    prisma.searchQueryCache.upsert.mockResolvedValue({})
    mocks.translateText
      .mockRejectedValueOnce(new Error('Gemini quota exceeded'))
      .mockResolvedValueOnce('Your Name')
      .mockResolvedValueOnce('君の名は')

    const result = await translateSearchQuery(prisma as any, 'test query', ['zh', 'en', 'ja'])

    expect(result.zh).toBe('test query') // Fallback to original
    expect(result.en).toBe('Your Name')
    expect(result.ja).toBe('君の名は')
  })
})

describe('searchWithFallback', () => {
  let prisma: ReturnType<typeof createPrismaMock>

  beforeEach(() => {
    vi.resetAllMocks()
    prisma = createPrismaMock()
  })

  it('Returns primary results when search finds matches', async () => {
    const primaryResults = {
      bangumi: [makeBangumi(1, 'Your Name')],
      points: [],
      cities: [],
    }
    mocks.searchDataset.mockResolvedValueOnce(primaryResults)

    const result = await searchWithFallback(prisma as any, 'zh', 'Your Name')

    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].id).toBe(1)
    expect(mocks.translateText).not.toHaveBeenCalled()
    expect(mocks.searchDataset).toHaveBeenCalledTimes(1)
  })

  it('Fallback translation when primary search returns empty', async () => {
    // Primary returns empty
    mocks.searchDataset.mockResolvedValueOnce(emptyResults())

    // Cache miss → translate
    prisma.searchQueryCache.findUnique.mockResolvedValue(null)
    prisma.searchQueryCache.upsert.mockResolvedValue({})
    mocks.translateText
      .mockResolvedValueOnce('你的名字')
      .mockResolvedValueOnce('Your Name')
      .mockResolvedValueOnce('君の名は')

    // Fallback searches return results
    mocks.searchDataset
      .mockResolvedValueOnce({
        bangumi: [makeBangumi(1, '你的名字')],
        points: [],
        cities: ['東京'],
      })
      .mockResolvedValueOnce({
        bangumi: [makeBangumi(2, 'Your Name')],
        points: [makePoint(10, 'Suga Shrine')],
        cities: [],
      })
      .mockResolvedValueOnce({
        bangumi: [makeBangumi(1, '君の名は')], // Duplicate id=1
        points: [],
        cities: ['東京'], // Duplicate city
      })

    const result = await searchWithFallback(prisma as any, 'zh', 'kimi no na wa')

    // Deduplicated: 2 unique bangumi (id 1 and 2), 1 point, 1 city
    expect(result.bangumi).toHaveLength(2)
    expect(result.points).toHaveLength(1)
    expect(result.cities).toHaveLength(1)
    expect(mocks.translateText).toHaveBeenCalledTimes(3)
  })

  it('Skips translated queries that match original', async () => {
    // Primary returns empty
    mocks.searchDataset.mockResolvedValueOnce(emptyResults())

    // Cache returns translations where en matches original
    prisma.searchQueryCache.findUnique.mockResolvedValue({
      queryText: 'tokyo',
      translatedZh: '东京',
      translatedEn: 'Tokyo', // Same as original (case-insensitive)
      translatedJa: '東京',
      createdAt: new Date(),
    })

    // Only 2 fallback searches (zh and ja, en matches original)
    mocks.searchDataset
      .mockResolvedValueOnce({
        bangumi: [makeBangumi(1, '东京')],
        points: [],
        cities: [],
      })
      .mockResolvedValueOnce({
        bangumi: [makeBangumi(2, '東京')],
        points: [],
        cities: [],
      })

    const result = await searchWithFallback(prisma as any, 'zh', 'Tokyo')

    // Primary (1) + 2 fallback (zh, ja — not en since it matches original)
    expect(mocks.searchDataset).toHaveBeenCalledTimes(3)
    expect(result.bangumi).toHaveLength(2)
  })

  it('Returns empty when all translations match original', async () => {
    mocks.searchDataset.mockResolvedValueOnce(emptyResults())

    prisma.searchQueryCache.findUnique.mockResolvedValue({
      queryText: 'test',
      translatedZh: 'test',
      translatedEn: 'test',
      translatedJa: 'test',
      createdAt: new Date(),
    })

    const result = await searchWithFallback(prisma as any, 'zh', 'test')

    // Primary only, no fallback since all translations same as original
    expect(mocks.searchDataset).toHaveBeenCalledTimes(1)
    expect(result).toEqual(emptyResults())
  })
})
