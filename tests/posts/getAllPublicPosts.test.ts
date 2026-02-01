import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import type { ArticleRepo } from '@/lib/article/repo'

vi.mock('@/lib/db/prisma', () => ({
  default: {
    article: {
      findMany: vi.fn(),
    },
  },
}))

describe('getAllPublicPosts - locale prefix', () => {
  const originalEnv = process.env.DATABASE_URL

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env.DATABASE_URL = originalEnv
  })

  it('should add /en/ prefix for English articles', async () => {
    const mockRepo: Pick<ArticleRepo, 'listByStatus'> = {
      listByStatus: vi.fn().mockResolvedValue([
        {
          slug: 'test-en-article',
          title: 'Test English Article',
          language: 'en',
          publishedAt: new Date('2024-01-01'),
          animeIds: [],
          city: '',
          tags: [],
          cover: null,
        },
      ]),
    }

    const result = await getAllPublicPosts('en', {
      mdx: { getAllPosts: vi.fn().mockResolvedValue([]) },
      articleRepo: mockRepo,
    })

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/en/posts/test-en-article')
  })

  it('should add /ja/ prefix for Japanese articles', async () => {
    const mockRepo: Pick<ArticleRepo, 'listByStatus'> = {
      listByStatus: vi.fn().mockResolvedValue([
        {
          slug: 'test-ja-article',
          title: 'Test Japanese Article',
          language: 'ja',
          publishedAt: new Date('2024-01-01'),
          animeIds: [],
          city: '',
          tags: [],
          cover: null,
        },
      ]),
    }

    const result = await getAllPublicPosts('ja', {
      mdx: { getAllPosts: vi.fn().mockResolvedValue([]) },
      articleRepo: mockRepo,
    })

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/ja/posts/test-ja-article')
  })

  it('should NOT add prefix for Chinese articles', async () => {
    const mockRepo: Pick<ArticleRepo, 'listByStatus'> = {
      listByStatus: vi.fn().mockResolvedValue([
        {
          slug: 'test-zh-article',
          title: 'Test Chinese Article',
          language: 'zh',
          publishedAt: new Date('2024-01-01'),
          animeIds: [],
          city: '',
          tags: [],
          cover: null,
        },
      ]),
    }

    const result = await getAllPublicPosts('zh', {
      mdx: { getAllPosts: vi.fn().mockResolvedValue([]) },
      articleRepo: mockRepo,
    })

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/posts/test-zh-article')
  })

  it('should default to Chinese path when language is missing', async () => {
    const mockRepo: Pick<ArticleRepo, 'listByStatus'> = {
      listByStatus: vi.fn().mockResolvedValue([
        {
          slug: 'test-no-lang',
          title: 'Test No Language',
          // language field missing
          publishedAt: new Date('2024-01-01'),
          animeIds: [],
          city: '',
          tags: [],
          cover: null,
        },
      ]),
    }

    const result = await getAllPublicPosts('zh', {
      mdx: { getAllPosts: vi.fn().mockResolvedValue([]) },
      articleRepo: mockRepo,
    })

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/posts/test-no-lang')
  })

  it('should handle mixed language articles correctly', async () => {
    const mockRepo: Pick<ArticleRepo, 'listByStatus'> = {
      listByStatus: vi.fn().mockResolvedValue([
        {
          slug: 'article-zh',
          title: 'Chinese Article',
          language: 'zh',
          publishedAt: new Date('2024-01-01'),
          animeIds: [],
          city: '',
          tags: [],
          cover: null,
        },
        {
          slug: 'article-en',
          title: 'English Article',
          language: 'en',
          publishedAt: new Date('2024-01-02'),
          animeIds: [],
          city: '',
          tags: [],
          cover: null,
        },
        {
          slug: 'article-ja',
          title: 'Japanese Article',
          language: 'ja',
          publishedAt: new Date('2024-01-03'),
          animeIds: [],
          city: '',
          tags: [],
          cover: null,
        },
      ]),
    }

    const result = await getAllPublicPosts('zh', {
      mdx: { getAllPosts: vi.fn().mockResolvedValue([]) },
      articleRepo: mockRepo,
    })

    expect(result).toHaveLength(3)
    
    const zhArticle = result.find(p => p.path.includes('article-zh'))
    const enArticle = result.find(p => p.path.includes('article-en'))
    const jaArticle = result.find(p => p.path.includes('article-ja'))

    expect(zhArticle?.path).toBe('/posts/article-zh')
    expect(enArticle?.path).toBe('/en/posts/article-en')
    expect(jaArticle?.path).toBe('/ja/posts/article-ja')
  })
})
