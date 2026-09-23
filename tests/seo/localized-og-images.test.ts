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

describe('ja/en 文章页 OG 图指向 /api/og/post/<slug>/<locale>.jpg', () => {
  it('ja', async () => {
    const { generateMetadata } = await import('@/app/ja/posts/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'btr-shimo' }) })
    const ogImage = (meta.openGraph?.images as { url: string }[])[0]!
    expect(ogImage.url).toContain('/api/og/post/')
    expect(ogImage.url).toMatch(/\/api\/og\/post\/btr-shimo\/ja\.jpg$/)
    const twitterImage = (meta.twitter?.images as { url: string }[])[0]!
    expect(twitterImage.url).toMatch(/\/api\/og\/post\/btr-shimo\/ja\.jpg$/)
  })

  it('en', async () => {
    const { generateMetadata } = await import('@/app/en/posts/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'btr-shimo' }) })
    const ogImage = (meta.openGraph?.images as { url: string }[])[0]!
    expect(ogImage.url).toContain('/api/og/post/')
    expect(ogImage.url).toMatch(/\/api\/og\/post\/btr-shimo\/en\.jpg$/)
    const twitterImage = (meta.twitter?.images as { url: string }[])[0]!
    expect(twitterImage.url).toMatch(/\/api\/og\/post\/btr-shimo\/en\.jpg$/)
  })
})
