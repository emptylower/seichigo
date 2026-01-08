import { describe, expect, it, vi, beforeEach } from 'vitest'

const getPublicPostBySlugMock = vi.fn()
vi.mock('@/lib/posts/getPublicPostBySlug', () => ({
  getPublicPostBySlug: (...args: any[]) => getPublicPostBySlugMock(...args),
}))

const getDbArticleForPublicNoticeMock = vi.fn()
vi.mock('@/lib/posts/getDbArticleForPublicNotice', () => ({
  getDbArticleForPublicNotice: (...args: any[]) => getDbArticleForPublicNoticeMock(...args),
}))

describe('post metadata', () => {
  beforeEach(() => {
    getPublicPostBySlugMock.mockReset()
    getDbArticleForPublicNoticeMock.mockReset()
  })

  it('uses seoTitle/description and canonical slug for MDX', async () => {
    getPublicPostBySlugMock.mockResolvedValueOnce({
      source: 'mdx',
      post: {
        frontmatter: {
          title: '正文标题',
          seoTitle: 'SEO 标题',
          description: '文章摘要',
          slug: 'btr-shimo',
          animeId: 'btr',
          city: '东京',
          publishDate: '2025-01-01',
          updatedDate: '2025-01-02',
          status: 'published',
          tags: [],
        },
        content: 'hi',
      },
    })

    const { generateMetadata } = await import('@/app/(site)/posts/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'btr-shimo' }) })

    expect(meta.title).toBe('SEO 标题')
    expect(meta.description).toBe('文章摘要')
    expect(meta.alternates?.canonical).toBe('/posts/btr-shimo')
    expect(meta.openGraph?.url).toBe('/posts/btr-shimo')
    expect(meta.openGraph?.title).toBe('SEO 标题')
    expect(meta.openGraph?.description).toBe('文章摘要')
  })

  it('canonical never points to legacy id key', async () => {
    getPublicPostBySlugMock.mockResolvedValueOnce({
      source: 'db',
      article: {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        slug: 'btr-hello',
        title: 'Hello',
        animeIds: ['btr'],
        city: 'Tokyo',
        contentHtml: '<p>DB 摘要</p>',
        status: 'published',
      },
    })

    const { generateMetadata } = await import('@/app/(site)/posts/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-legacy' }) })

    expect(meta.alternates?.canonical).toBe('/posts/btr-hello')
    expect(meta.openGraph?.url).toBe('/posts/btr-hello')
  })
})

