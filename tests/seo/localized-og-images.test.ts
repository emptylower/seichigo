import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/posts/getPublicPostBySlug', () => ({
  getPublicPostBySlug: async () => ({
    source: 'mdx',
    isFallback: false,
    post: {
      frontmatter: {
        title: '标题',
        seoTitle: 'SEO 标题',
        description: '摘要',
        slug: 'btr-shimo',
        animeId: 'btr',
        city: '东京',
      },
      content: 'hi',
    },
  }),
}))
vi.mock('@/lib/posts/getDbArticleForPublicNotice', () => ({
  getDbArticleForPublicNotice: async () => null,
}))
vi.mock('@/lib/publicOverride/service', () => ({
  resolvePublicOverrideForPost: async () => null,
}))

describe('ja/en 文章页 OG 图指向 zh 的专属路由', () => {
  it('ja', async () => {
    const { generateMetadata } = await import('@/app/ja/posts/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'btr-shimo' }) })
    expect(meta.openGraph?.images).toEqual(['/posts/btr-shimo/opengraph-image'])
    expect(meta.twitter?.images).toEqual(['/posts/btr-shimo/twitter-image'])
  })

  it('en', async () => {
    const { generateMetadata } = await import('@/app/en/posts/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'btr-shimo' }) })
    expect(meta.openGraph?.images).toEqual(['/posts/btr-shimo/opengraph-image'])
    expect(meta.twitter?.images).toEqual(['/posts/btr-shimo/twitter-image'])
  })
})
