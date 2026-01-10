import { describe, expect, it } from 'vitest'
import { InMemoryArticleRepo } from '@/lib/article/repoMemory'
import { InMemoryArticleRevisionRepo } from '@/lib/articleRevision/repoMemory'

describe('article revision repo contract (in-memory)', () => {
  it('getOrCreateActiveFromArticle copies snapshot and is idempotent', async () => {
    const articleRepo = new InMemoryArticleRepo()
    const article = await articleRepo.createDraft({
      authorId: 'user-1',
      slug: 'btr-hello',
      title: 'Hello',
      animeIds: ['btr'],
      city: 'Tokyo',
      routeLength: '1h',
      tags: ['t1'],
      cover: '/assets/c1',
      contentJson: { type: 'doc' },
      contentHtml: '<p>hello</p>',
    })

    const revisionRepo = new InMemoryArticleRevisionRepo()

    const r1 = await revisionRepo.getOrCreateActiveFromArticle(article)
    expect(r1.articleId).toBe(article.id)
    expect(r1.authorId).toBe(article.authorId)
    expect(r1.status).toBe('draft')
    expect(r1.title).toBe(article.title)
    expect(r1.animeIds).toEqual(article.animeIds)
    expect(r1.city).toBe(article.city)
    expect(r1.routeLength).toBe(article.routeLength)
    expect(r1.tags).toEqual(article.tags)
    expect(r1.cover).toBe(article.cover)
    expect(r1.contentHtml).toBe(article.contentHtml)

    const r2 = await revisionRepo.getOrCreateActiveFromArticle(article)
    expect(r2.id).toBe(r1.id)
  })

  it('approved revision becomes inactive and allows new active revision', async () => {
    const articleRepo = new InMemoryArticleRepo()
    const article = await articleRepo.createDraft({
      authorId: 'user-1',
      slug: 'btr-hello',
      title: 'Hello',
      animeIds: ['btr'],
      contentHtml: '<p>hello</p>',
    })

    const revisionRepo = new InMemoryArticleRevisionRepo()
    const active = await revisionRepo.getOrCreateActiveFromArticle(article)

    const approved = await revisionRepo.updateState(active.id, { status: 'approved' })
    expect(approved?.status).toBe('approved')

    const stillActive = await revisionRepo.findActiveByArticleId(article.id)
    expect(stillActive).toBe(null)

    const nextActive = await revisionRepo.getOrCreateActiveFromArticle(article)
    expect(nextActive.id).not.toBe(active.id)
    expect(nextActive.status).toBe('draft')
  })

  it('updateDraft updates fields', async () => {
    const articleRepo = new InMemoryArticleRepo()
    const article = await articleRepo.createDraft({ authorId: 'user-1', slug: 'btr-hello', title: 'Hello', animeIds: ['btr'] })

    const revisionRepo = new InMemoryArticleRevisionRepo()
    const active = await revisionRepo.getOrCreateActiveFromArticle(article)

    const updated = await revisionRepo.updateDraft(active.id, {
      title: 'Hello v2',
      tags: ['t2'],
      city: null,
      contentHtml: '<p>updated</p>',
    })

    expect(updated?.title).toBe('Hello v2')
    expect(updated?.tags).toEqual(['t2'])
    expect(updated?.city).toBe(null)
    expect(updated?.contentHtml).toBe('<p>updated</p>')
  })
})

