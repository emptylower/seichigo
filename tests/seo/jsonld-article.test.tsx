import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const getPublicPostBySlugMock = vi.fn()
vi.mock('@/lib/posts/getPublicPostBySlug', () => ({
  getPublicPostBySlug: (...args: any[]) => getPublicPostBySlugMock(...args),
}))

const getDbArticleForPublicNoticeMock = vi.fn()
vi.mock('@/lib/posts/getDbArticleForPublicNotice', () => ({
  getDbArticleForPublicNotice: (...args: any[]) => getDbArticleForPublicNoticeMock(...args),
}))

describe('post json-ld', () => {
  beforeEach(() => {
    getPublicPostBySlugMock.mockReset()
    getDbArticleForPublicNoticeMock.mockReset()
  })

  it('renders Article JSON-LD once', async () => {
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
        content: <div>body</div>,
      },
    })

    const PostPage = (await import('@/app/(site)/posts/[slug]/page')).default
    const { container } = render(await PostPage({ params: Promise.resolve({ slug: 'btr-shimo' }) }))

    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'))
    const parsed = scripts
      .map((s) => {
        try {
          return JSON.parse(s.textContent || '')
        } catch {
          return null
        }
      })
      .filter(Boolean) as any[]

    const articles = parsed.filter((x) => x['@type'] === 'Article')
    expect(articles).toHaveLength(1)
  })
})

