import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

function createPrismaMock() {
  return {
    anitabiBangumi: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    anitabiPoint: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  }
}

describe('searchDataset - cross-language bangumi search', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('Chinese query matches titleZh (existing behavior regression)', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiBangumi.findMany.mockResolvedValue([
      {
        id: 1,
        titleZh: '冰菓',
        titleJaRaw: '氷菓',
        mapEnabled: true,
        sourceModifiedMs: 1000000,
        meta: { pointsLength: 5, imagesLength: 10 },
        i18n: [],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'zh',
      q: '冰菓',
    })

    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].title).toBe('冰菓')
    expect(prisma.anitabiBangumi.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          mapEnabled: true,
          OR: expect.arrayContaining([
            { titleZh: { contains: '冰菓', mode: 'insensitive' } },
          ]),
        }),
      })
    )
  })

  it('Japanese query matches titleJaRaw (existing behavior regression)', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiBangumi.findMany.mockResolvedValue([
      {
        id: 2,
        titleZh: '冰菓',
        titleJaRaw: '氷菓',
        mapEnabled: true,
        sourceModifiedMs: 1000000,
        meta: { pointsLength: 5, imagesLength: 10 },
        i18n: [],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'zh',
      q: '氷菓',
    })

    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].title).toBe('冰菓')
  })

  it('English query matches AnitabiBangumiI18n.title (new behavior)', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiBangumi.findMany.mockResolvedValue([
      {
        id: 3,
        titleZh: '冰菓',
        titleJaRaw: '氷菓',
        mapEnabled: true,
        sourceModifiedMs: 1000000,
        meta: { pointsLength: 5, imagesLength: 10 },
        i18n: [{ title: 'Hyouka' }],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'en',
      q: 'Hyouka',
    })

    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].title).toBe('Hyouka')
  })

  it('English original name matches titleOriginal/titleRomaji/titleEnglish (new)', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiBangumi.findMany.mockResolvedValue([
      {
        id: 4,
        titleZh: '冰菓',
        titleJaRaw: '氷菓',
        titleOriginal: 'Hyouka',
        titleRomaji: 'Hyouka',
        titleEnglish: 'Hyouka',
        mapEnabled: true,
        sourceModifiedMs: 1000000,
        meta: { pointsLength: 5, imagesLength: 10 },
        i18n: [],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'en',
      q: 'Hyouka',
    })

    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].titleZh).toBe('冰菓')
  })

  it('Alias query matches aliases array (new)', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiBangumi.findMany.mockResolvedValue([
      {
        id: 5,
        titleZh: '冰菓',
        titleJaRaw: '氷菓',
        aliases: ['Hyoka', 'Ice Cream'],
        mapEnabled: true,
        sourceModifiedMs: 1000000,
        meta: { pointsLength: 5, imagesLength: 10 },
        i18n: [],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'en',
      q: 'Hyoka',
    })

    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].titleZh).toBe('冰菓')
  })

  it('Partial match works with contains mode', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiBangumi.findMany.mockResolvedValue([
      {
        id: 6,
        titleZh: '冰菓',
        titleJaRaw: '氷菓',
        mapEnabled: true,
        sourceModifiedMs: 1000000,
        meta: { pointsLength: 5, imagesLength: 10 },
        i18n: [],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'zh',
      q: '冰',
    })

    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].title).toBe('冰菓')
  })

  it('No results returns empty array', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiBangumi.findMany.mockResolvedValue([])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'zh',
      q: 'nonexistent',
    })

    expect(result.bangumi).toEqual([])
    expect(result.points).toEqual([])
    expect(result.cities).toEqual([])
  })

  it('Deduplication: same bangumi matched by multiple fields appears once', async () => {
    const prisma = createPrismaMock()
    // Simulate same bangumi matching both titleZh and i18n.title
    prisma.anitabiBangumi.findMany.mockResolvedValue([
      {
        id: 7,
        titleZh: 'Hyouka',
        titleJaRaw: '氷菓',
        mapEnabled: true,
        sourceModifiedMs: 1000000,
        meta: { pointsLength: 5, imagesLength: 10 },
        i18n: [{ title: 'Hyouka' }],
      },
      {
        id: 7,
        titleZh: 'Hyouka',
        titleJaRaw: '氷菓',
        mapEnabled: true,
        sourceModifiedMs: 1000000,
        meta: { pointsLength: 5, imagesLength: 10 },
        i18n: [{ title: 'Hyouka' }],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'en',
      q: 'Hyouka',
    })

    // Should deduplicate by bangumi ID
    expect(result.bangumi).toHaveLength(1)
    expect(result.bangumi[0].id).toBe(7)
  })

  it('buildBangumiWhere consistency: same search scope as searchDataset', async () => {
    const prisma = createPrismaMock()
    
    // This test verifies that buildBangumiWhere (used in other parts of the codebase)
    // produces the same WHERE clause as searchDataset
    const { buildBangumiWhere } = await import('@/lib/anitabi/read')
    
    const whereClause = buildBangumiWhere({
      locale: 'en',
      q: 'Hyouka',
    })

    // Should include all the same fields as searchDataset
    expect(whereClause).toHaveProperty('mapEnabled', true)
    expect(whereClause).toHaveProperty('OR')
    expect(whereClause.OR).toEqual(
      expect.arrayContaining([
        { titleZh: { contains: 'hyouka', mode: 'insensitive' } },
        { titleJaRaw: { contains: 'hyouka', mode: 'insensitive' } },
        { titleOriginal: { contains: 'hyouka', mode: 'insensitive' } },
        { titleRomaji: { contains: 'hyouka', mode: 'insensitive' } },
        { titleEnglish: { contains: 'hyouka', mode: 'insensitive' } },
        { i18n: { some: { language: 'en', title: { contains: 'hyouka', mode: 'insensitive' } } } },
      ])
    )
  })
})
