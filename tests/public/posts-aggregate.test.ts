import { describe, expect, it } from 'vitest'
import { InMemoryArticleRepo } from '@/lib/article/repoMemory'
import type { Post, PostFrontmatter } from '@/lib/mdx/types'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { getPublicPostBySlug } from '@/lib/posts/getPublicPostBySlug'

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

    expect(list.map((x) => x.path)).toEqual([`/posts/${created.id}-db-1`])
    expect(list[0]?.source).toBe('db')
  })

  it('getAllPublicPosts: merges and sorts by publishDate/publishedAt desc', async () => {
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
    expect(list.map((x) => x.path)).toEqual([`/posts/${created.id}-db-1`, '/posts/mdx-1'])
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

  it('getPublicPostBySlug: slug only in DB(published) -> returns DB', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({ authorId: 'u1', slug: 'db-only', title: 'DB Only' })
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const mdx = makeMdxProvider()
    const found = await getPublicPostBySlug('db-only', 'zh', { mdx, articleRepo: repo })

    expect(found?.source).toBe('db')
    expect(found && found.source === 'db' ? found.article.title : null).toBe('DB Only')
  })

  it('getPublicPostBySlug: slug only in DB(draft/review) -> returns null', async () => {
    const repo = new InMemoryArticleRepo()
    await repo.createDraft({ authorId: 'u1', slug: 'draft-only', title: 'Draft Only' })

    const mdx = makeMdxProvider()
    const found = await getPublicPostBySlug('draft-only', 'zh', { mdx, articleRepo: repo })
    expect(found).toBe(null)
  })
})
