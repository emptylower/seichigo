import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listPublishedDbPostsByCityId } from '@/lib/city/posts'
import { prisma } from '@/lib/db/prisma'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    articleCity: {
      findMany: vi.fn(),
    },
  },
}))

describe('listPublishedDbPostsByCityId', () => {
  const mockFindMany = prisma.articleCity.findMany as any

  beforeEach(() => {
    mockFindMany.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should filter by language=en and generate /en/posts/ path', async () => {
    mockFindMany.mockResolvedValue([
      {
        article: {
          slug: 'tokyo-article',
          title: 'Tokyo Guide',
          language: 'en',
          animeIds: ['anime1'],
          city: 'Tokyo',
          routeLength: '5km',
          publishedAt: new Date('2024-01-01'),
          cover: 'cover.jpg',
          updatedAt: new Date('2024-01-02'),
        },
      },
    ])

    const result = await listPublishedDbPostsByCityId('city123', 'en')

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        cityId: 'city123',
        article: {
          status: 'published',
          language: 'en',
        },
      },
      orderBy: [{ article: { publishedAt: 'desc' } }, { article: { updatedAt: 'desc' } }],
      select: {
        article: {
          select: {
            slug: true,
            title: true,
            language: true,
            animeIds: true,
            city: true,
            routeLength: true,
            publishedAt: true,
            cover: true,
            updatedAt: true,
          },
        },
      },
    })

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/en/posts/tokyo-article')
    expect(result[0].title).toBe('Tokyo Guide')
  })

  it('should filter by language=ja and generate /ja/posts/ path', async () => {
    mockFindMany.mockResolvedValue([
      {
        article: {
          slug: 'kyoto-article',
          title: '京都ガイド',
          language: 'ja',
          animeIds: ['anime2'],
          city: 'Kyoto',
          routeLength: '3km',
          publishedAt: new Date('2024-01-01'),
          cover: 'cover2.jpg',
          updatedAt: new Date('2024-01-02'),
        },
      },
    ])

    const result = await listPublishedDbPostsByCityId('city456', 'ja')

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        cityId: 'city456',
        article: {
          status: 'published',
          language: 'ja',
        },
      },
      orderBy: [{ article: { publishedAt: 'desc' } }, { article: { updatedAt: 'desc' } }],
      select: {
        article: {
          select: {
            slug: true,
            title: true,
            language: true,
            animeIds: true,
            city: true,
            routeLength: true,
            publishedAt: true,
            cover: true,
            updatedAt: true,
          },
        },
      },
    })

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/ja/posts/kyoto-article')
    expect(result[0].title).toBe('京都ガイド')
  })

  it('should filter by language=zh and generate /posts/ path (no locale prefix)', async () => {
    mockFindMany.mockResolvedValue([
      {
        article: {
          slug: 'shanghai-article',
          title: '上海指南',
          language: 'zh',
          animeIds: ['anime3'],
          city: 'Shanghai',
          routeLength: '7km',
          publishedAt: new Date('2024-01-01'),
          cover: 'cover3.jpg',
          updatedAt: new Date('2024-01-02'),
        },
      },
    ])

    const result = await listPublishedDbPostsByCityId('city789', 'zh')

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        cityId: 'city789',
        article: {
          status: 'published',
          language: 'zh',
        },
      },
      orderBy: [{ article: { publishedAt: 'desc' } }, { article: { updatedAt: 'desc' } }],
      select: {
        article: {
          select: {
            slug: true,
            title: true,
            language: true,
            animeIds: true,
            city: true,
            routeLength: true,
            publishedAt: true,
            cover: true,
            updatedAt: true,
          },
        },
      },
    })

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/posts/shanghai-article')
    expect(result[0].title).toBe('上海指南')
  })

  it('should not filter by language when language param is undefined', async () => {
    mockFindMany.mockResolvedValue([
      {
        article: {
          slug: 'osaka-article',
          title: 'Osaka Guide',
          language: 'en',
          animeIds: ['anime4'],
          city: 'Osaka',
          routeLength: '4km',
          publishedAt: new Date('2024-01-01'),
          cover: 'cover4.jpg',
          updatedAt: new Date('2024-01-02'),
        },
      },
    ])

    const result = await listPublishedDbPostsByCityId('city999')

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        cityId: 'city999',
        article: {
          status: 'published',
        },
      },
      orderBy: [{ article: { publishedAt: 'desc' } }, { article: { updatedAt: 'desc' } }],
      select: {
        article: {
          select: {
            slug: true,
            title: true,
            language: true,
            animeIds: true,
            city: true,
            routeLength: true,
            publishedAt: true,
            cover: true,
            updatedAt: true,
          },
        },
      },
    })

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/en/posts/osaka-article')
  })

  it('should handle empty cityId', async () => {
    const result = await listPublishedDbPostsByCityId('')

    expect(mockFindMany).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('should handle articles without publishedAt', async () => {
    mockFindMany.mockResolvedValue([
      {
        article: {
          slug: 'no-date-article',
          title: 'No Date Article',
          language: 'en',
          animeIds: [],
          city: 'Unknown',
          routeLength: null,
          publishedAt: null,
          cover: null,
          updatedAt: new Date('2024-01-02'),
        },
      },
    ])

    const result = await listPublishedDbPostsByCityId('city123', 'en')

    expect(result).toHaveLength(1)
    expect(result[0].publishDate).toBeUndefined()
    expect(result[0].path).toBe('/en/posts/no-date-article')
  })
})
