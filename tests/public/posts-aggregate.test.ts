import { describe, expect, it } from 'vitest'
import { InMemoryArticleRepo } from '@/lib/article/repoMemory'
import type { Post, PostFrontmatter } from '@/lib/mdx/types'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { getPublicPostBySlug } from '@/lib/posts/getPublicPostBySlug'
import { generateSlugFromTitle } from '@/lib/article/slug'

type MdxProvider = {
  getAllPosts: (language: string) => Promise<PostFrontmatter[]>
  getPostBySlug: (slug: string, language: string) => Promise<Post | null>
}

function makeMdxProvider(options?: {
  all?: PostFrontmatter[]
  bySlug?: Record<string, Post | null>
}): MdxProvider {
  const all = options?.all ?? []
  const bySlug = options?.bySlug ?? {}
  return {
    async getAllPosts() {
      return all
    },
    async getPostBySlug(slug: string) {
      return bySlug[slug] ?? null
    },
  }
}

describe('public posts aggregation', () => {
  it('getAllPublicPosts: MDX empty, DB published -> returns DB', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({ authorId: 'u1', slug: 'db-1', title: 'DB 1' })
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const mdx = makeMdxProvider({ all: [] })
    const list = await getAllPublicPosts('zh', { mdx, articleRepo: repo })

    expect(list.map((x) => x.path)).toEqual([`/posts/db-1`])
    expect(list[0]?.source).toBe('db')
  })

  it('getAllPublicPosts: merges and sorts by publishedAt/publishDate desc', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({ authorId: 'u1', slug: 'db-1', title: 'DB 1' })
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-03T00:00:00.000Z') })

    const mdx = makeMdxProvider({
      all: [
        {
          title: 'MDX 1',
          slug: 'mdx-1',
          animeId: 'btr',
          city: '东京',
          publishDate: '2025-01-02',
          status: 'published',
          tags: [],
        },
      ],
    })

    const list = await getAllPublicPosts('zh', { mdx, articleRepo: repo })
    expect(list.map((x) => x.path)).toEqual([`/posts/db-1`, '/posts/mdx-1'])
  })

  it('getAllPublicPosts: keeps order by first published time (ignores lastApprovedAt bumps)', async () => {
    const repo = new InMemoryArticleRepo()

    const older = await repo.createDraft({ authorId: 'u1', slug: 'db-older', title: 'DB Older' })
    await repo.updateState(older.id, {
      status: 'published',
      publishedAt: new Date('2025-01-01T00:00:00.000Z'),
      lastApprovedAt: new Date('2025-02-01T00:00:00.000Z'),
    })

    const newer = await repo.createDraft({ authorId: 'u1', slug: 'db-newer', title: 'DB Newer' })
    await repo.updateState(newer.id, {
      status: 'published',
      publishedAt: new Date('2025-01-15T00:00:00.000Z'),
    })

    const mdx = makeMdxProvider({ all: [] })
    const list = await getAllPublicPosts('zh', { mdx, articleRepo: repo })

    expect(list.map((x) => x.path)).toEqual([`/posts/db-newer`, `/posts/db-older`])
  })

  it('getPublicPostBySlug: slug exists in MDX -> returns MDX (priority)', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({ authorId: 'u1', slug: 'same', title: 'DB Same' })
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const mdxPost: Post = {
      frontmatter: { title: 'MDX Same', slug: 'same', animeId: 'btr', city: '东京', status: 'published' },
      content: 'hello',
    }
    const mdx = makeMdxProvider({ bySlug: { same: mdxPost } })

    const found = await getPublicPostBySlug('same', 'zh', { mdx, articleRepo: repo })
    expect(found?.source).toBe('mdx')
  })

  it('getAllPublicPosts: keeps MDX when path collides', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({ authorId: 'u1', slug: 'same', title: 'DB Same' })
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const mdx = makeMdxProvider({
      all: [
        {
          title: 'MDX Same',
          slug: 'same',
          animeId: 'btr',
          city: '东京',
          publishDate: '2025-01-02',
          status: 'published',
          tags: [],
        },
      ],
    })

    const list = await getAllPublicPosts('zh', { mdx, articleRepo: repo })
    expect(list).toHaveLength(1)
    expect(list[0]?.path).toBe('/posts/same')
    expect(list[0]?.source).toBe('mdx')
  })

  it('getPublicPostBySlug: slug only in DB(published) -> returns DB', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({ authorId: 'u1', slug: 'db-only', title: 'DB Only' })
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const mdx = makeMdxProvider()
    const found = await getPublicPostBySlug('db-only', 'zh', { mdx, articleRepo: repo })

    expect(found?.source).toBe('db')
    expect(found && found.source === 'db' ? found.article.title : null).toBe('DB Only')
  })

  it('getPublicPostBySlug: id-only and id-slug key both resolve DB', async () => {
    const repo = new InMemoryArticleRepo({
      idFactory: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    })
    const created = await repo.createDraft({ authorId: 'u1', slug: 'db-only', title: 'DB Only' })
    expect(created.id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const mdx = makeMdxProvider()

    const byId = await getPublicPostBySlug(created.id, 'zh', { mdx, articleRepo: repo })
    expect(byId?.source).toBe('db')

    const byIdSlug = await getPublicPostBySlug(`${created.id}-legacy`, 'zh', { mdx, articleRepo: repo })
    expect(byIdSlug?.source).toBe('db')
  })

  it('getPublicPostBySlug: legacy fallback hash slug resolves DB and can redirect to current slug', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({ authorId: 'u1', slug: 'btr-uji-day1', title: '宇治一日游' })
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const legacy = generateSlugFromTitle(created.title, new Date('2025-01-01T00:00:00.000Z'))
    expect(legacy).toMatch(/^post-[0-9a-f]{10}$/)

    const mdx = makeMdxProvider()
    const found = await getPublicPostBySlug(legacy, 'zh', { mdx, articleRepo: repo })
    expect(found?.source).toBe('db')
    expect(found && found.source === 'db' ? found.article.slug : null).toBe('btr-uji-day1')
  })

  it('getPublicPostBySlug: DB contentHtml rewrites internal images progressively', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({
      authorId: 'u1',
      slug: 'db-img',
      title: 'DB Img',
      contentHtml: '<p><img src="/assets/abc123" alt="x" /></p>',
    })
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const mdx = makeMdxProvider()
    const found = await getPublicPostBySlug('db-img', 'zh', { mdx, articleRepo: repo })
    expect(found?.source).toBe('db')

    const html = found && found.source === 'db' ? found.article.contentHtml : ''
    expect(html).toContain('data-seichi-full="/assets/abc123"')
    expect(html).toContain('src="/assets/abc123?w=32&amp;q=20"')
  })

  it('getPublicPostBySlug: renders seichi-route embed for DB content', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({
      authorId: 'u1',
      slug: 'db-route',
      title: 'DB Route',
      contentHtml: '<p>hi</p><seichi-route data-id="r1"></seichi-route>',
      contentJson: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
          { type: 'seichiRoute', attrs: { id: 'r1', data: { version: 1, spots: [{ name_zh: 'A' }, { name_zh: 'B' }] } } },
        ],
      },
    })
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const mdx = makeMdxProvider()
    const found = await getPublicPostBySlug('db-route', 'zh', { mdx, articleRepo: repo })
    expect(found?.source).toBe('db')

    const html = found && found.source === 'db' ? found.article.contentHtml : ''
    expect(html).not.toContain('<seichi-route')
    expect(html).toContain('<svg')
    expect(html).toContain('<table')
  })

  it('getPublicPostBySlug: percent-encoded unicode slug resolves DB', async () => {
    const repo = new InMemoryArticleRepo()
    const slug = '你的名字-your-name-seichigo-tokyo-shinjuku'
    const created = await repo.createDraft({ authorId: 'u1', slug, title: 'Your Name' })
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const mdx = makeMdxProvider()
    const encoded = '%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97-your-name-seichigo-tokyo-shinjuku'
    const found = await getPublicPostBySlug(encoded, 'zh', { mdx, articleRepo: repo })

    expect(found?.source).toBe('db')
    expect(found && found.source === 'db' ? found.article.slug : null).toBe(slug)
  })

  it('getPublicPostBySlug: slug only in DB(draft/review) -> returns null', async () => {
    const repo = new InMemoryArticleRepo()
    await repo.createDraft({ authorId: 'u1', slug: 'draft-only', title: 'Draft Only' })

    const mdx = makeMdxProvider()
    const found = await getPublicPostBySlug('draft-only', 'zh', { mdx, articleRepo: repo })
    expect(found).toBe(null)
  })
})
