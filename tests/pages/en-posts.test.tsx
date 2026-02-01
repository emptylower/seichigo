import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock dependencies
vi.mock('next/navigation', () => ({
  notFound: () => <div>Not Found</div>,
  permanentRedirect: (url: string) => {
    throw new Error(`Redirected to ${url}`)
  },
}))

const getPublicPostBySlugMock = vi.fn()
vi.mock('@/lib/posts/getPublicPostBySlug', () => ({
  getPublicPostBySlug: (...args: any[]) => getPublicPostBySlugMock(...args),
}))

const getDbArticleForPublicNoticeMock = vi.fn()
vi.mock('@/lib/posts/getDbArticleForPublicNotice', () => ({
  getDbArticleForPublicNotice: (...args: any[]) => getDbArticleForPublicNoticeMock(...args),
}))

vi.mock('@/lib/anime/getAllAnime', () => ({
  getAnimeById: vi.fn().mockResolvedValue({ name: 'Test Anime' }),
}))

vi.mock('@/lib/seo/site', () => ({
  getSiteOrigin: () => 'https://seichigo.com',
}))

// Mock components to avoid rendering complexity
vi.mock('@/components/blog/PostMeta', () => ({
  default: () => <div data-testid="post-meta">Post Meta</div>,
}))
vi.mock('@/components/comments/CommentSection', () => ({
  default: () => <div data-testid="comment-section">Comments</div>,
}))
vi.mock('@/components/content/ProgressiveImagesRuntime', () => ({
  default: () => null,
}))
vi.mock('@/components/content/FavoriteButton', () => ({
  default: () => <button>Favorite</button>,
}))
vi.mock('@/components/layout/Breadcrumbs', () => ({
  default: ({ items }: any) => (
    <div data-testid="breadcrumbs">
      {items.map((i: any) => i.name).join(' > ')}
    </div>
  ),
}))
vi.mock('@/components/toc/ArticleToc', () => ({
  default: () => <div>TOC</div>,
}))
vi.mock('@/lib/seo/placeJsonLd', () => ({
  default: () => null,
}))

describe('English Post Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders English content when available', async () => {
    getPublicPostBySlugMock.mockImplementation((slug, locale) => {
      if (locale === 'en') {
        return Promise.resolve({
          source: 'mdx',
          post: {
            frontmatter: {
              title: 'English Title',
              slug: 'test-slug',
              animeId: 'anime-1',
              city: 'Tokyo',
              publishDate: '2025-01-01',
            },
            content: <div>English Content</div>,
          },
        })
      }
      return Promise.resolve(null)
    })

    const EnPostPage = (await import('@/app/en/posts/[slug]/page')).default
    render(await EnPostPage({ params: Promise.resolve({ slug: 'test-slug' }) }))

    expect(screen.getByText('English Title')).toBeInTheDocument()
    expect(screen.getByText('English Content')).toBeInTheDocument()
    expect(screen.queryByText(/English translation is not available yet/)).not.toBeInTheDocument()
    expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('Home > Anime > Test Anime > English Title')
  })

  it('falls back to Chinese content with warning when English is missing', async () => {
    getPublicPostBySlugMock.mockImplementation((slug, locale) => {
      if (locale === 'en') return Promise.resolve(null)
      if (locale === 'zh') {
        return Promise.resolve({
          source: 'mdx',
          post: {
            frontmatter: {
              title: 'Chinese Title',
              slug: 'test-slug',
              animeId: 'anime-1',
              city: 'Tokyo',
              publishDate: '2025-01-01',
            },
            content: <div>Chinese Content</div>,
          },
        })
      }
      return Promise.resolve(null)
    })

    const EnPostPage = (await import('@/app/en/posts/[slug]/page')).default
    render(await EnPostPage({ params: Promise.resolve({ slug: 'test-slug' }) }))

    expect(screen.getByText('Chinese Title')).toBeInTheDocument()
    expect(screen.getByText('Chinese Content')).toBeInTheDocument()
    expect(screen.getByText('English translation is not available yet')).toBeInTheDocument()
    expect(screen.getByText(/showing the original Chinese content/)).toBeInTheDocument()
  })
})
