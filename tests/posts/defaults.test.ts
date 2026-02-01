import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

const mockPrisma = {
  article: {
    findMany: vi.fn(),
  },
}

vi.mock('@/lib/db/prisma', () => ({
  prisma: mockPrisma,
}))

describe('PublicArticleRepo.listByStatus with language filter', () => {
  const originalEnv = process.env.DATABASE_URL

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  })

  afterEach(() => {
    process.env.DATABASE_URL = originalEnv
  })

  it('filters by language when provided', async () => {
    const { getDefaultPublicArticleRepo } = await import('@/lib/posts/defaults')
    
    mockPrisma.article.findMany.mockResolvedValue([
      {
        id: '1',
        authorId: 'user-1',
        slug: 'chinese-article',
        language: 'zh',
        translationGroupId: null,
        title: 'Chinese Article',
        seoTitle: null,
        description: null,
        animeIds: [],
        city: null,
        routeLength: null,
        tags: [],
        cover: null,
        contentJson: null,
        contentHtml: '',
        status: 'published',
        rejectReason: null,
        needsRevision: false,
        publishedAt: new Date(),
        lastApprovedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const repo = await getDefaultPublicArticleRepo()
    const articles = await repo!.listByStatus('published', 'zh')

    expect(mockPrisma.article.findMany).toHaveBeenCalledWith({
      where: { status: 'published', language: 'zh' },
      orderBy: { updatedAt: 'desc' },
      select: expect.any(Object),
    })
    expect(articles).toHaveLength(1)
    expect(articles[0]?.language).toBe('zh')
  })

  it('returns all articles when language not provided (backward compatible)', async () => {
    const { getDefaultPublicArticleRepo } = await import('@/lib/posts/defaults')
    
    mockPrisma.article.findMany.mockResolvedValue([
      {
        id: '1',
        authorId: 'user-1',
        slug: 'chinese-article',
        language: 'zh',
        translationGroupId: null,
        title: 'Chinese Article',
        seoTitle: null,
        description: null,
        animeIds: [],
        city: null,
        routeLength: null,
        tags: [],
        cover: null,
        contentJson: null,
        contentHtml: '',
        status: 'published',
        rejectReason: null,
        needsRevision: false,
        publishedAt: new Date(),
        lastApprovedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        authorId: 'user-2',
        slug: 'english-article',
        language: 'en',
        translationGroupId: null,
        title: 'English Article',
        seoTitle: null,
        description: null,
        animeIds: [],
        city: null,
        routeLength: null,
        tags: [],
        cover: null,
        contentJson: null,
        contentHtml: '',
        status: 'published',
        rejectReason: null,
        needsRevision: false,
        publishedAt: new Date(),
        lastApprovedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const repo = await getDefaultPublicArticleRepo()
    const articles = await repo!.listByStatus('published')

    expect(mockPrisma.article.findMany).toHaveBeenCalledWith({
      where: { status: 'published' },
      orderBy: { updatedAt: 'desc' },
      select: expect.any(Object),
    })
    expect(articles).toHaveLength(2)
  })

  it('filters English articles when language=en', async () => {
    const { getDefaultPublicArticleRepo } = await import('@/lib/posts/defaults')
    
    mockPrisma.article.findMany.mockResolvedValue([
      {
        id: '2',
        authorId: 'user-2',
        slug: 'english-article',
        language: 'en',
        translationGroupId: null,
        title: 'English Article',
        seoTitle: null,
        description: null,
        animeIds: [],
        city: null,
        routeLength: null,
        tags: [],
        cover: null,
        contentJson: null,
        contentHtml: '',
        status: 'published',
        rejectReason: null,
        needsRevision: false,
        publishedAt: new Date(),
        lastApprovedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const repo = await getDefaultPublicArticleRepo()
    const articles = await repo!.listByStatus('published', 'en')

    expect(mockPrisma.article.findMany).toHaveBeenCalledWith({
      where: { status: 'published', language: 'en' },
      orderBy: { updatedAt: 'desc' },
      select: expect.any(Object),
    })
    expect(articles).toHaveLength(1)
    expect(articles[0]?.language).toBe('en')
  })
})
