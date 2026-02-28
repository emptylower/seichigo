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

describe('searchDataset - cross-language point search', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('English point name matches AnitabiPointI18n.name', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiPoint.findMany.mockResolvedValue([
      {
        id: 'point-1',
        bangumiId: 1,
        name: '神山高校',
        nameZh: '神山高中',
        geoLat: 36.0,
        geoLng: 137.0,
        updatedAt: new Date(),
        i18n: [{ name: 'Kamiyama High School', note: 'Main school location' }],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'en',
      q: 'Kamiyama High School',
    })

    expect(result.points).toHaveLength(1)
    expect(result.points[0].name).toBe('Kamiyama High School')
    expect(result.points[0].nameZh).toBe('神山高中')
  })

  it('English partial point name matches', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiPoint.findMany.mockResolvedValue([
      {
        id: 'point-2',
        bangumiId: 1,
        name: '神山高校',
        nameZh: '神山高中',
        geoLat: 36.0,
        geoLng: 137.0,
        updatedAt: new Date(),
        i18n: [{ name: 'Kamiyama High School' }],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'en',
      q: 'Kamiyama',
    })

    expect(result.points).toHaveLength(1)
    expect(result.points[0].name).toBe('Kamiyama High School')
  })

  it('Chinese point name still works (existing behavior)', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiPoint.findMany.mockResolvedValue([
      {
        id: 'point-3',
        bangumiId: 1,
        name: '神山高校',
        nameZh: '神山高中',
        geoLat: 36.0,
        geoLng: 137.0,
        updatedAt: new Date(),
        i18n: [],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'zh',
      q: '神山',
    })

    expect(result.points).toHaveLength(1)
    expect(result.points[0].nameZh).toBe('神山高中')
  })

  it('Japanese point name still works (existing behavior)', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiPoint.findMany.mockResolvedValue([
      {
        id: 'point-4',
        bangumiId: 1,
        name: '神山高校',
        nameZh: '神山高中',
        geoLat: 36.0,
        geoLng: 137.0,
        updatedAt: new Date(),
        i18n: [],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'zh',
      q: '神山高校',
    })

    expect(result.points).toHaveLength(1)
    expect(result.points[0].name).toBe('神山高校')
  })

  it('No i18n data falls back to original name', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiPoint.findMany.mockResolvedValue([
      {
        id: 'point-5',
        bangumiId: 1,
        name: '神山高校',
        nameZh: '神山高中',
        geoLat: 36.0,
        geoLng: 137.0,
        updatedAt: new Date(),
        i18n: [],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'en',
      q: '神山',
    })

    expect(result.points).toHaveLength(1)
    // Should fall back to nameZh when no i18n available
    expect(result.points[0].nameZh).toBe('神山高中')
  })

  it('Point search respects locale parameter', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiPoint.findMany.mockResolvedValue([
      {
        id: 'point-6',
        bangumiId: 1,
        name: '神山高校',
        nameZh: '神山高中',
        geoLat: 36.0,
        geoLng: 137.0,
        updatedAt: new Date(),
        i18n: [{ name: 'Kamiyama High School' }],
      },
    ])

    const { searchDataset } = await import('@/lib/anitabi/read')
    const result = await searchDataset({
      prisma: prisma as any,
      locale: 'en',
      q: 'school',
    })

    expect(prisma.anitabiPoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          i18n: expect.objectContaining({
            where: { language: 'en' },
          }),
        }),
      })
    )
  })
})
