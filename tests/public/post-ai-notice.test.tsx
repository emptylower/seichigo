import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  notFound: () => <div>文章不存在或已下架</div>,
  permanentRedirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))

vi.mock('@/lib/publicOverride/service', () => ({
  resolvePublicOverrideForPost: vi.fn().mockResolvedValue(null),
}))

const getPublicPostBySlugMock = vi.fn()
vi.mock('@/lib/posts/getPublicPostBySlug', () => ({
  getPublicPostBySlug: (...args: any[]) => getPublicPostBySlugMock(...args),
}))

vi.mock('@/lib/posts/getDbArticleForPublicNotice', () => ({
  getDbArticleForPublicNotice: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/anime/getAllAnime', () => ({
  getAnimeById: async (id: string) => ({ id, name: id }),
}))

vi.mock('@/lib/route/extract', () => ({
  extractSeichiRouteEmbedsFromTipTapJson: () => [],
}))

vi.mock('@/components/comments/CommentSection', () => ({ default: () => <div data-testid="comments" /> }))
vi.mock('@/components/content/ArticleShareButtons', () => ({ default: () => <div /> }))
vi.mock('@/components/content/FavoriteButton', () => ({ default: () => <div /> }))
vi.mock('@/components/content/ProgressiveImagesRuntime', () => ({ default: () => null }))
vi.mock('@/components/toc/ArticleToc', () => ({ default: () => <div /> }))
vi.mock('@/lib/seo/placeJsonLd', () => ({ default: () => null }))

describe('public post page AI-assisted notice', () => {
  it('renders the notice for an MDX post tagged seo-spoke', async () => {
    getPublicPostBySlugMock.mockResolvedValueOnce({
      source: 'mdx',
      post: {
        frontmatter: {
          title: '测试 AI 辅助文章',
          slug: 'ai-spoke-test',
          animeId: 'your-name',
          city: '东京',
          routeLength: '5km',
          publishDate: '2026-01-01',
          tags: ['seo-spoke'],
        },
        contentHtml: '<p>正文</p>',
      },
    })

    const PostPage = (await import('@/app/(site)/posts/[slug]/page')).default
    const { container } = render(await PostPage({ params: Promise.resolve({ slug: 'ai-spoke-test' }) }))

    expect(container.textContent).toContain('本文由 AI 辅助整理，实地信息持续校对中。发现有误请通过')
    expect(container.textContent).toContain('帮助中心')
  })

  it('does not render the notice for a DB article without the seo-spoke tag', async () => {
    const slug = '你的名字-your-name-seichigo-tokyo-shinjuku'
    getPublicPostBySlugMock.mockResolvedValueOnce({
      source: 'db',
      article: {
        id: 'a1',
        slug,
        title: 'Your Name',
        city: '东京',
        routeLength: null,
        publishedAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
        animeIds: ['your-name'],
        tags: [],
        seoTitle: null,
        description: null,
        cover: null,
        contentHtml: '<p>正文</p>',
        contentJson: {},
      },
    })

    const PostPage = (await import('@/app/(site)/posts/[slug]/page')).default
    const { container } = render(await PostPage({ params: Promise.resolve({ slug }) }))

    expect(container.textContent).not.toContain('本文由 AI 辅助整理')
    expect(container.textContent).not.toContain('帮助中心')
  })
})
