import { describe, expect, it } from 'vitest'
import { InMemoryArticleRepo } from '@/lib/article/repoMemory'
import type { PostFrontmatter, Post } from '@/lib/mdx/types'
import { getPostsByAnimeId } from '@/lib/posts/getPostsByAnimeId'

type MdxProvider = {
  getAllPosts: (language: string) => Promise<PostFrontmatter[]>
  getPostBySlug: (slug: string, language: string) => Promise<Post | null>
}

function makeMdxProvider(options?: { all?: PostFrontmatter[] }): MdxProvider {
  const all = options?.all ?? []
  return {
    async getAllPosts() {
      return all
    },
    async getPostBySlug() {
      return null
    },
  }
}

describe('getPostsByAnimeId', () => {
  it('filters and keeps publishDate/publishedAt desc', async () => {
    const repo = new InMemoryArticleRepo()
    const a1 = await repo.createDraft({ authorId: 'u1', slug: 'db-1', title: 'DB 1', animeIds: ['btr'] as any })
    const a2 = await repo.createDraft({ authorId: 'u1', slug: 'db-2', title: 'DB 2', animeIds: ['btr'] as any })
    const other = await repo.createDraft({ authorId: 'u1', slug: 'db-x', title: 'DB X', animeIds: ['hibike'] as any })

    await repo.updateState(a1.id, { status: 'published', publishedAt: new Date('2025-01-03T00:00:00.000Z') })
    await repo.updateState(a2.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })
    await repo.updateState(other.id, { status: 'published', publishedAt: new Date('2025-01-02T00:00:00.000Z') })

    const mdx = makeMdxProvider({
      all: [
        { title: 'MDX 1', slug: 'mdx-1', animeId: 'btr', city: '东京', publishDate: '2025-01-02', status: 'published', tags: [] },
      ],
    })

    const list = await getPostsByAnimeId('btr', 'zh', { mdx, articleRepo: repo })
    expect(list.map((x) => x.path)).toEqual(['/posts/db-1', '/posts/mdx-1', '/posts/db-2'])
  })

  it('decodes percent-encoded unicode anime id', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({ authorId: 'u1', slug: 'db-1', title: 'DB 1', animeIds: ['你的名字'] as any })
    await repo.updateState(created.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const mdx = makeMdxProvider({ all: [] })
    const encoded = '%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97'
    const list = await getPostsByAnimeId(encoded, 'zh', { mdx, articleRepo: repo })
    expect(list.map((x) => x.path)).toEqual(['/posts/db-1'])
  })
})
