import { describe, expect, it } from 'vitest'
import { InMemoryArticleRepo } from '@/lib/article/repoMemory'

describe('article repo contract (in-memory)', () => {
  it('createDraft defaults to status=draft', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({
      authorId: 'user-1',
      slug: 'my-first-article',
      title: 'My First Article',
    })
    expect(created.status).toBe('draft')
    expect(created.needsRevision).toBe(false)
    expect(created.slug).toBe('my-first-article')
    expect(created.authorId).toBe('user-1')
  })

  it('findBySlug returns created article', async () => {
    const repo = new InMemoryArticleRepo()
    await repo.createDraft({ authorId: 'user-1', slug: 'a', title: 'A' })
    const found = await repo.findBySlug('a')
    expect(found?.title).toBe('A')
  })

  it('listByAuthor returns only the author articles', async () => {
    const repo = new InMemoryArticleRepo()
    await repo.createDraft({ authorId: 'user-1', slug: 'a', title: 'A' })
    await repo.createDraft({ authorId: 'user-2', slug: 'b', title: 'B' })
    const mine = await repo.listByAuthor('user-1')
    expect(mine).toHaveLength(1)
    expect(mine[0]?.slug).toBe('a')
  })

  it('updateDraft updates fields', async () => {
    const repo = new InMemoryArticleRepo()
    const created = await repo.createDraft({ authorId: 'user-1', slug: 'a', title: 'A' })
    const updated = await repo.updateDraft(created.id, { title: 'A2' })
    expect(updated?.title).toBe('A2')
    const fetched = await repo.findById(created.id)
    expect(fetched?.title).toBe('A2')
  })
})
