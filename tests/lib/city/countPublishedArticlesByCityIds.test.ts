import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    articleCity: {
      groupBy: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

describe('lib/city/db - countPublishedArticlesByCityIds', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('language filter', () => {
    it('includes language filter in groupBy when language parameter is provided', async () => {
      mocks.prisma.articleCity.groupBy.mockResolvedValue([
        { cityId: 'tokyo', _count: { _all: 5 } },
        { cityId: 'kyoto', _count: { _all: 3 } },
      ])

      const { countPublishedArticlesByCityIds } = await import('@/lib/city/db')
      const result = await countPublishedArticlesByCityIds(['tokyo', 'kyoto'], 'en')

      expect(mocks.prisma.articleCity.groupBy).toHaveBeenCalledTimes(1)
      const callArgs = mocks.prisma.articleCity.groupBy.mock.calls[0]?.[0]
      
      expect(callArgs.where).toMatchObject({
        cityId: { in: ['tokyo', 'kyoto'] },
        article: { status: 'published', language: 'en' },
      })
      
      expect(result).toEqual({
        tokyo: 5,
        kyoto: 3,
      })
    })

    it('includes language filter for Japanese', async () => {
      mocks.prisma.articleCity.groupBy.mockResolvedValue([
        { cityId: 'osaka', _count: { _all: 2 } },
      ])

      const { countPublishedArticlesByCityIds } = await import('@/lib/city/db')
      await countPublishedArticlesByCityIds(['osaka'], 'ja')

      const callArgs = mocks.prisma.articleCity.groupBy.mock.calls[0]?.[0]
      
      expect(callArgs.where.article).toMatchObject({
        status: 'published',
        language: 'ja',
      })
    })

    it('omits language filter when language parameter is not provided', async () => {
      mocks.prisma.articleCity.groupBy.mockResolvedValue([
        { cityId: 'tokyo', _count: { _all: 10 } },
      ])

      const { countPublishedArticlesByCityIds } = await import('@/lib/city/db')
      await countPublishedArticlesByCityIds(['tokyo'])

      const callArgs = mocks.prisma.articleCity.groupBy.mock.calls[0]?.[0]
      
      expect(callArgs.where).toMatchObject({
        cityId: { in: ['tokyo'] },
        article: { status: 'published' },
      })
      
      expect(callArgs.where.article).not.toHaveProperty('language')
    })

    it('returns empty object when cityIds is empty', async () => {
      const { countPublishedArticlesByCityIds } = await import('@/lib/city/db')
      const result = await countPublishedArticlesByCityIds([])

      expect(mocks.prisma.articleCity.groupBy).not.toHaveBeenCalled()
      expect(result).toEqual({})
    })
  })
})
