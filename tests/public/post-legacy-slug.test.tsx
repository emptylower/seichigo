import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const permanentRedirectMock = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`)
})

vi.mock('next/navigation', () => ({
  notFound: () => <div>文章不存在或已下架</div>,
  permanentRedirect: (url: string) => permanentRedirectMock(url),
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

const OLD_SLUG = '你的名字-your-name-seichigo-tokyo-shinjuku'
const OLD_SLUG_ENCODED = encodeURIComponent(OLD_SLUG)
const NEW_SLUG = 'your-name-pilgrimage-part1-tokyo-shinjuku'

type PageModule = {
  default: (props: { params: Promise<{ slug: string }> }) => Promise<React.ReactNode>
  generateMetadata: (props: { params: Promise<{ slug: string }> }) => Promise<unknown>
}

const PAGES: Array<{ label: string; path: string; prefix: string }> = [
  { label: 'zh', path: '@/app/(site)/posts/[slug]/page', prefix: '/posts' },
  { label: 'ja', path: '@/app/ja/posts/[slug]/page', prefix: '/ja/posts' },
  { label: 'en', path: '@/app/en/posts/[slug]/page', prefix: '/en/posts' },
]

beforeEach(() => {
  permanentRedirectMock.mockClear()
  getPublicPostBySlugMock.mockReset()
  getPublicPostBySlugMock.mockResolvedValue(null)
})

describe('legacy post slug permanent redirect', () => {
  for (const { label, path, prefix } of PAGES) {
    describe(`${label} page`, () => {
      it(`permanentRedirects raw legacy slug to ${prefix}`, async () => {
        const Page = (await import(path)).default as PageModule['default']
        await expect(Page({ params: Promise.resolve({ slug: OLD_SLUG }) })).rejects.toThrow(
          `redirect:${prefix}/${NEW_SLUG}`
        )
        expect(permanentRedirectMock).toHaveBeenCalledTimes(1)
        expect(permanentRedirectMock).toHaveBeenCalledWith(`${prefix}/${NEW_SLUG}`)
      })

      it(`permanentRedirects percent-encoded legacy slug to ${prefix}`, async () => {
        const Page = (await import(path)).default as PageModule['default']
        await expect(Page({ params: Promise.resolve({ slug: OLD_SLUG_ENCODED }) })).rejects.toThrow(
          `redirect:${prefix}/${NEW_SLUG}`
        )
      })

      it('does not redirect the new slug', async () => {
        const Page = (await import(path)).default as PageModule['default']
        const { container } = render(await Page({ params: Promise.resolve({ slug: NEW_SLUG }) }))
        expect(permanentRedirectMock).not.toHaveBeenCalled()
        expect(getPublicPostBySlugMock).toHaveBeenCalled()
        expect(container.textContent).toBeTruthy()
      })
    })
  }

  it('zh generateMetadata also permanentRedirects legacy slug', async () => {
    const { generateMetadata } = (await import('@/app/(site)/posts/[slug]/page')) as PageModule
    await expect(generateMetadata({ params: Promise.resolve({ slug: OLD_SLUG }) })).rejects.toThrow(
      `redirect:/posts/${NEW_SLUG}`
    )
  })
})
