import { describe, expect, it } from 'vitest'
import { InMemoryArticleRepo } from '@/lib/article/repoMemory'
import { getDbArticleForPublicNotice } from '@/lib/posts/getDbArticleForPublicNotice'

describe('getDbArticleForPublicNotice', () => {
  it('resolves by slug when id cannot be extracted', async () => {
    const repo = new InMemoryArticleRepo({
      idFactory: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    })
    const created = await repo.createDraft({ authorId: 'u1', slug: 'hello-world', title: 'Hello' })
    await repo.updateState(created.id, { status: 'rejected', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const found = await getDbArticleForPublicNotice('hello-world', { articleRepo: repo })
    expect(found?.id).toBe(created.id)
  })

  it('resolves by id when key contains id prefix', async () => {
    const repo = new InMemoryArticleRepo({
      idFactory: () => 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    })
    const created = await repo.createDraft({ authorId: 'u1', slug: 'hello', title: 'Hello' })
    await repo.updateState(created.id, { status: 'rejected', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const found = await getDbArticleForPublicNotice(`${created.id}-anything`, { articleRepo: repo })
    expect(found?.id).toBe(created.id)
  })
})

