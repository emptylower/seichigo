import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cross-language search integration test.
 *
 * Tests all 4 layers working together:
 *   Layer A – i18n table search (BangumiI18n / PointI18n)
 *   Layer B – Original title fields (titleOriginal, titleRomaji, titleEnglish, aliases)
 *   Layer C – Query-time translation fallback (Gemini + cache)
 *   Layer D – Glossary term protection (loaded inside translateText)
 */

// ---------------------------------------------------------------------------
// Hoisted mocks – wired before any import resolution
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  translateText: vi.fn(),
  searchDataset: vi.fn(),
}))

vi.mock('@/lib/translation/gemini', () => ({
  translateText: (...args: unknown[]) => mocks.translateText(...args),
}))

vi.mock('@/lib/anitabi/read', () => ({
  searchDataset: (...args: unknown[]) => mocks.searchDataset(...args),
}))

import { searchWithFallback } from '@/lib/anitabi/searchCache'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function emptyResults() {
  return { bangumi: [], points: [], cities: [] }
}

function makeBangumiCard(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Title ${id}`,
    titleZh: null as string | null,
    cat: null,
    city: null,
    cover: null,
    color: null,
    pointsLength: 0,
    imagesLength: 0,
    sourceModifiedMs: null,
    mapEnabled: true,
    geo: null,
    zoom: null,
    nearestDistanceMeters: null,
    ...overrides,
  }
}

function makePointDto(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    bangumiId: 1,
    name: `Point ${id}`,
    nameZh: null as string | null,
    note: null,
    geo: null,
    ep: null,
    s: null,
    image: null,
    origin: null,
    originUrl: null,
    originLink: null,
    density: null,
    mark: null,
    ...overrides,
  }
}

function createPrismaMock() {
  return {
    searchQueryCache: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Cross-language search integration (all 4 layers)', () => {
  let prisma: ReturnType<typeof createPrismaMock>

  beforeEach(() => {
    vi.resetAllMocks()
    prisma = createPrismaMock()
  })

  // =========================================================================
  // Scenario 1 – Layer B: English original name → titleOriginal match
  // =========================================================================
  it('Scenario 1: English original name search → titleOriginal match → returns Chinese result', async () => {
    // searchDataset finds bangumi via titleOriginal="Girls Band Cry" on the primary call
    const bangumi = makeBangumiCard(101, {
      title: '哭泣少女乐队',
      titleZh: '哭泣少女乐队',
    })
    mocks.searchDataset.mockResolvedValueOnce({
      bangumi: [bangumi],
      points: [],
      cities: [],
    })

    const result = await searchWithFallback(prisma as any, 'zh', 'Girls Band Cry')

    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].title).toBe('哭泣少女乐队')
    expect(result.bangumi[0].titleZh).toBe('哭泣少女乐队')
    // Primary search found results – no translation fallback needed
    expect(mocks.translateText).not.toHaveBeenCalled()
    expect(mocks.searchDataset).toHaveBeenCalledTimes(1)
  })

  // =========================================================================
  // Scenario 2 – Layer A: English i18n title → BangumiI18n match
  // =========================================================================
  it('Scenario 2: English i18n title search → i18n table match → returns result', async () => {
    // searchDataset finds bangumi because i18n table has locale=en, title="Hyouka"
    const bangumi = makeBangumiCard(102, {
      title: 'Hyouka', // pickLocalizedTitle resolved from i18n
      titleZh: '冰菓',
    })
    mocks.searchDataset.mockResolvedValueOnce({
      bangumi: [bangumi],
      points: [],
      cities: [],
    })

    const result = await searchWithFallback(prisma as any, 'en', 'Hyouka')

    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].title).toBe('Hyouka')
    expect(result.bangumi[0].titleZh).toBe('冰菓')
    expect(mocks.translateText).not.toHaveBeenCalled()
    expect(mocks.searchDataset).toHaveBeenCalledTimes(1)
  })

  // =========================================================================
  // Scenario 3 – Layer B: Japanese search → titleJaRaw match
  // =========================================================================
  it('Scenario 3: Japanese search → titleJaRaw match → returns Chinese result', async () => {
    const bangumi = makeBangumiCard(103, {
      title: '冰菓',
      titleZh: '冰菓',
    })
    mocks.searchDataset.mockResolvedValueOnce({
      bangumi: [bangumi],
      points: [],
      cities: ['高山市'],
    })

    const result = await searchWithFallback(prisma as any, 'zh', '氷菓')

    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].title).toBe('冰菓')
    expect(result.cities).toEqual(['高山市'])
    expect(mocks.translateText).not.toHaveBeenCalled()
    expect(mocks.searchDataset).toHaveBeenCalledTimes(1)
  })

  // =========================================================================
  // Scenario 4 – Layer C + D: Unknown term → fallback translation → finds result
  // =========================================================================
  it('Scenario 4: Unknown search term → primary fails → fallback translation → finds result', async () => {
    // Primary search returns empty
    mocks.searchDataset.mockResolvedValueOnce(emptyResults())

    // Cache miss → translateSearchQuery calls translateText for zh/en/ja
    prisma.searchQueryCache.findUnique.mockResolvedValue(null)
    mocks.translateText
      .mockResolvedValueOnce('哭泣少女乐队')  // zh
      .mockResolvedValueOnce('Girls Band Cry') // en (same as query – will be deduped)
      .mockResolvedValueOnce('ガールズバンドクライ') // ja

    // Fallback searches with translated queries
    const bangumiZh = makeBangumiCard(104, {
      title: '哭泣少女乐队',
      titleZh: '哭泣少女乐队',
    })
    const bangumiJa = makeBangumiCard(104, { // Same bangumi, found via ja
      title: '哭泣少女乐队',
      titleZh: '哭泣少女乐队',
    })
    mocks.searchDataset
      .mockResolvedValueOnce({
        bangumi: [bangumiZh],
        points: [],
        cities: [],
      })
      .mockResolvedValueOnce({
        bangumi: [bangumiJa],
        points: [],
        cities: [],
      })

    const result = await searchWithFallback(prisma as any, 'zh', 'Girls Band Cry')

    // Found via fallback translation
    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].title).toBe('哭泣少女乐队')

    // translateText called for all 3 languages
    expect(mocks.translateText).toHaveBeenCalledTimes(3)

    // Primary (1) + 2 fallback (zh, ja; en deduped as same as original)
    expect(mocks.searchDataset).toHaveBeenCalledTimes(3)

    // Cache was written
    expect(prisma.searchQueryCache.upsert).toHaveBeenCalledOnce()
  })

  // =========================================================================
  // Scenario 5 – Layer A (points): Point English name → PointI18n match
  // =========================================================================
  it('Scenario 5: Point English name search → PointI18n match → returns result', async () => {
    const point = makePointDto('p-201', {
      bangumiId: 105,
      name: 'Akihabara Station',
      nameZh: '秋叶原站',
    })
    mocks.searchDataset.mockResolvedValueOnce({
      bangumi: [],
      points: [point],
      cities: [],
    })

    const result = await searchWithFallback(prisma as any, 'en', 'Akihabara Station')

    expect(result.points).toHaveLength(1)
    expect(result.points[0].name).toBe('Akihabara Station')
    expect(result.points[0].nameZh).toBe('秋叶原站')
    // Points found on primary – no fallback
    expect(mocks.translateText).not.toHaveBeenCalled()
    expect(mocks.searchDataset).toHaveBeenCalledTimes(1)
  })

  // =========================================================================
  // Scenario 6 – No results → graceful handling
  // =========================================================================
  it('Scenario 6: No results anywhere → graceful empty response', async () => {
    // Primary search returns empty
    mocks.searchDataset.mockResolvedValueOnce(emptyResults())

    // Cache miss → translate
    prisma.searchQueryCache.findUnique.mockResolvedValue(null)
    mocks.translateText
      .mockResolvedValueOnce('完全虚构的动漫')  // zh
      .mockResolvedValueOnce('Totally Made Up Anime') // en
      .mockResolvedValueOnce('完全架空のアニメ') // ja

    // Fallback searches also return empty
    mocks.searchDataset
      .mockResolvedValueOnce(emptyResults())
      .mockResolvedValueOnce(emptyResults())
      .mockResolvedValueOnce(emptyResults())

    const result = await searchWithFallback(prisma as any, 'zh', 'xyznonexistent')

    expect(result.bangumi).toEqual([])
    expect(result.points).toEqual([])
    expect(result.cities).toEqual([])
    // No errors thrown – graceful
    expect(mocks.translateText).toHaveBeenCalledTimes(3)
  })

  // =========================================================================
  // Bonus: Mixed results across bangumi + points from fallback
  // =========================================================================
  it('Bonus: Fallback merges bangumi and points from multiple translated queries', async () => {
    // Primary empty
    mocks.searchDataset.mockResolvedValueOnce(emptyResults())

    // Cached translation hit (no Gemini call needed)
    prisma.searchQueryCache.findUnique.mockResolvedValue({
      queryText: 'your name',
      translatedZh: '你的名字',
      translatedEn: 'Your Name',
      translatedJa: '君の名は',
      createdAt: new Date(),
    })

    // Fallback: zh finds bangumi, ja finds a point
    mocks.searchDataset
      .mockResolvedValueOnce({
        bangumi: [makeBangumiCard(200, { title: '你的名字', titleZh: '你的名字' })],
        points: [],
        cities: ['東京'],
      })
      .mockResolvedValueOnce({
        bangumi: [makeBangumiCard(200, { title: '君の名は', titleZh: '你的名字' })], // duplicate id
        points: [makePointDto('p-300', { name: '須賀神社', nameZh: '须贺神社', bangumiId: 200 })],
        cities: ['東京'], // duplicate city
      })

    const result = await searchWithFallback(prisma as any, 'zh', 'Your Name')

    // Deduplicated: 1 unique bangumi
    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].id).toBe(200)
    // Point from ja fallback included
    expect(result.points).toHaveLength(1)
    expect(result.points[0].nameZh).toBe('须贺神社')
    // Deduplicated cities
    expect(result.cities).toEqual(['東京'])
    // Translation came from cache – no Gemini calls
    expect(mocks.translateText).not.toHaveBeenCalled()
  })
})
