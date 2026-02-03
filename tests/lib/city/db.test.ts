import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    city: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    cityRedirect: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

describe('lib/city/db - Japanese field selection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('getCityBySlug', () => {
    it('selects description_ja and transportTips_ja from database', async () => {
      mocks.prisma.city.findUnique.mockResolvedValue({
        id: 'tokyo',
        slug: 'tokyo',
        name_zh: '東京',
        name_en: 'Tokyo',
        name_ja: '東京',
        description_zh: '中文描述',
        description_en: 'English description',
        description_ja: '日本語の説明',
        transportTips_zh: '中文交通',
        transportTips_en: 'English transport',
        transportTips_ja: '日本語の交通情報',
        cover: null,
        needsReview: false,
        hidden: false,
      })

      const { getCityBySlug } = await import('@/lib/city/db')
      const result = await getCityBySlug('tokyo')

      expect(mocks.prisma.city.findUnique).toHaveBeenCalledTimes(1)
      const callArgs = mocks.prisma.city.findUnique.mock.calls[0]?.[0]
      
      // Assert that select includes Japanese fields
      expect(callArgs.select).toHaveProperty('description_ja', true)
      expect(callArgs.select).toHaveProperty('transportTips_ja', true)
      
      // Assert that result includes Japanese fields
      expect(result).toHaveProperty('description_ja', '日本語の説明')
      expect(result).toHaveProperty('transportTips_ja', '日本語の交通情報')
    })
  })

  describe('getCityBySlugOrRedirect', () => {
    it('selects description_ja and transportTips_ja when city found directly', async () => {
      mocks.prisma.city.findUnique.mockResolvedValue({
        id: 'tokyo',
        slug: 'tokyo',
        name_zh: '東京',
        name_en: 'Tokyo',
        name_ja: '東京',
        description_zh: '中文描述',
        description_en: 'English description',
        description_ja: '日本語の説明',
        transportTips_zh: '中文交通',
        transportTips_en: 'English transport',
        transportTips_ja: '日本語の交通情報',
        cover: null,
        needsReview: false,
        hidden: false,
      })

      const { getCityBySlugOrRedirect } = await import('@/lib/city/db')
      const { city } = await getCityBySlugOrRedirect('tokyo')

      expect(mocks.prisma.city.findUnique).toHaveBeenCalledTimes(1)
      const callArgs = mocks.prisma.city.findUnique.mock.calls[0]?.[0]
      
      expect(callArgs.select).toHaveProperty('description_ja', true)
      expect(callArgs.select).toHaveProperty('transportTips_ja', true)
      
      expect(city).toHaveProperty('description_ja', '日本語の説明')
      expect(city).toHaveProperty('transportTips_ja', '日本語の交通情報')
    })

    it('selects description_ja and transportTips_ja when redirecting', async () => {
      mocks.prisma.city.findUnique
        .mockResolvedValueOnce(null) // First call: city not found
        .mockResolvedValueOnce({ // Second call: target city found
          id: 'tokyo',
          slug: 'tokyo',
          name_zh: '東京',
          name_en: 'Tokyo',
          name_ja: '東京',
          description_zh: '中文描述',
          description_en: 'English description',
          description_ja: '日本語の説明',
          transportTips_zh: '中文交通',
          transportTips_en: 'English transport',
          transportTips_ja: '日本語の交通情報',
          cover: null,
          needsReview: false,
          hidden: false,
        })
      
      mocks.prisma.cityRedirect.findUnique.mockResolvedValue({
        fromSlug: 'old-tokyo',
        toCityId: 'tokyo',
      })

      const { getCityBySlugOrRedirect } = await import('@/lib/city/db')
      const { city, redirectToSlug } = await getCityBySlugOrRedirect('old-tokyo')

      // Second findUnique call should be for the redirect target
      expect(mocks.prisma.city.findUnique).toHaveBeenCalledTimes(2)
      const secondCall = mocks.prisma.city.findUnique.mock.calls[1]?.[0]
      
      expect(secondCall.select).toHaveProperty('description_ja', true)
      expect(secondCall.select).toHaveProperty('transportTips_ja', true)
      
      expect(redirectToSlug).toBe('tokyo')
      expect(city).toHaveProperty('description_ja', '日本語の説明')
      expect(city).toHaveProperty('transportTips_ja', '日本語の交通情報')
    })
  })

  describe('listCitiesForIndex', () => {
    it('selects description_ja and transportTips_ja for all cities', async () => {
      mocks.prisma.city.findMany.mockResolvedValue([
        {
          id: 'tokyo',
          slug: 'tokyo',
          name_zh: '東京',
          name_en: 'Tokyo',
          name_ja: '東京',
          description_zh: '中文描述',
          description_en: 'English description',
          description_ja: '日本語の説明',
          transportTips_zh: '中文交通',
          transportTips_en: 'English transport',
          transportTips_ja: '日本語の交通情報',
          cover: null,
          needsReview: false,
          hidden: false,
        },
      ])

      const { listCitiesForIndex } = await import('@/lib/city/db')
      const result = await listCitiesForIndex()

      expect(mocks.prisma.city.findMany).toHaveBeenCalledTimes(1)
      const callArgs = mocks.prisma.city.findMany.mock.calls[0]?.[0]
      
      expect(callArgs.select).toHaveProperty('description_ja', true)
      expect(callArgs.select).toHaveProperty('transportTips_ja', true)
      
      expect(result[0]).toHaveProperty('description_ja', '日本語の説明')
      expect(result[0]).toHaveProperty('transportTips_ja', '日本語の交通情報')
    })
  })
})
