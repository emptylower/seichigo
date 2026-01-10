import { describe, expect, it } from 'vitest'
import { InMemoryArticleRepo } from '@/lib/article/repoMemory'
import { InMemoryArticleRevisionRepo } from '@/lib/articleRevision/repoMemory'
import type { ArticleRevisionApiDeps } from '@/lib/articleRevision/api'

import { createHandlers as createAdminReviewListHandlers } from '@/lib/articleRevision/handlers/adminReviewList'
import { createHandlers as createAdminApproveHandlers } from '@/lib/articleRevision/handlers/adminApprove'
import { createHandlers as createAdminRejectHandlers } from '@/lib/articleRevision/handlers/adminReject'

function jsonReq(url: string, method: string, body?: any): Request {
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

function makeDeps(options?: { session?: any; now?: Date }): { deps: ArticleRevisionApiDeps; setSession: (s: any) => void } {
  const now = options?.now ?? new Date('2025-01-01T00:00:00.000Z')
  const articleRepo = new InMemoryArticleRepo({ now: () => now })
  const revisionRepo = new InMemoryArticleRevisionRepo({ now: () => now })

  let currentSession: any = options?.session ?? null
  const deps: ArticleRevisionApiDeps = {
    articleRepo,
    revisionRepo,
    getSession: async () => currentSession,
    sanitizeHtml: (html) => `sanitized:${html}`,
    now: () => now,
  }
  return { deps, setSession: (s) => (currentSession = s) }
}

describe('article revision admin api', () => {
  it('requires admin', async () => {
    const { deps } = makeDeps({ session: { user: { id: 'user-1', isAdmin: false } } })
    const adminList = createAdminReviewListHandlers(deps)

    const res = await adminList.GET(jsonReq('http://localhost/api/admin/review/revisions?status=in_review', 'GET'))
    expect(res.status).toBe(403)
  })

  it('admin can list in_review revisions', async () => {
    const { deps, setSession } = makeDeps({ session: { user: { id: 'admin-1', isAdmin: true } } })

    const article = await deps.articleRepo.createDraft({
      authorId: 'user-1',
      slug: 'btr-hello',
      title: 'Hello',
      animeIds: ['btr'],
      contentHtml: `<p>${'x'.repeat(120)}</p>`,
    })
    const publishedAt = new Date('2024-01-02T00:00:00.000Z')
    await deps.articleRepo.updateState(article.id, { status: 'published', publishedAt })

    const rev = await deps.revisionRepo.getOrCreateActiveFromArticle(article)
    await deps.revisionRepo.updateState(rev.id, { status: 'in_review' })

    const adminList = createAdminReviewListHandlers(deps)
    const res = await adminList.GET(jsonReq('http://localhost/api/admin/review/revisions?status=in_review', 'GET'))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.items.map((x: any) => x.id)).toContain(rev.id)

    // non-admin forbidden
    setSession({ user: { id: 'user-1', isAdmin: false } })
    const forbidden = await adminList.GET(jsonReq('http://localhost/api/admin/review/revisions?status=in_review', 'GET'))
    expect(forbidden.status).toBe(403)
  })

  it('admin approve applies revision to published article and keeps publishedAt unchanged', async () => {
    const fixedNow = new Date('2025-01-01T00:00:00.000Z')
    const { deps } = makeDeps({ now: fixedNow, session: { user: { id: 'admin-1', isAdmin: true } } })

    const article = await deps.articleRepo.createDraft({
      authorId: 'user-1',
      slug: 'btr-hello',
      title: 'Hello',
      animeIds: ['btr'],
      tags: [],
      contentHtml: `<p>${'x'.repeat(120)}</p>`,
    })
    const publishedAt = new Date('2024-01-02T00:00:00.000Z')
    await deps.articleRepo.updateState(article.id, { status: 'published', publishedAt })

    const rev = await deps.revisionRepo.getOrCreateActiveFromArticle(article)
    await deps.revisionRepo.updateDraft(rev.id, { title: 'Hello v2', tags: ['t2'] })
    await deps.revisionRepo.updateState(rev.id, { status: 'in_review' })

    const adminApprove = createAdminApproveHandlers(deps)
    const res = await adminApprove.POST(jsonReq('http://localhost/api/admin/review/revisions/' + rev.id + '/approve', 'POST'), {
      params: Promise.resolve({ id: rev.id }),
    })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.revision.status).toBe('approved')

    const updatedArticle = await deps.articleRepo.findById(article.id)
    expect(updatedArticle?.status).toBe('published')
    expect(updatedArticle?.publishedAt?.toISOString()).toBe(publishedAt.toISOString())
    expect(updatedArticle?.lastApprovedAt?.toISOString()).toBe(fixedNow.toISOString())
    expect(updatedArticle?.title).toBe('Hello v2')
    expect(updatedArticle?.tags).toEqual(['t2'])

    const active = await deps.revisionRepo.findActiveByArticleId(article.id)
    expect(active).toBe(null)
  })

  it('admin reject stores reason and keeps revision active', async () => {
    const { deps } = makeDeps({ session: { user: { id: 'admin-1', isAdmin: true } } })

    const article = await deps.articleRepo.createDraft({
      authorId: 'user-1',
      slug: 'btr-hello',
      title: 'Hello',
      animeIds: ['btr'],
      contentHtml: `<p>${'x'.repeat(120)}</p>`,
    })
    await deps.articleRepo.updateState(article.id, { status: 'published', publishedAt: deps.now() })

    const rev = await deps.revisionRepo.getOrCreateActiveFromArticle(article)
    await deps.revisionRepo.updateState(rev.id, { status: 'in_review' })

    const adminReject = createAdminRejectHandlers(deps)

    const bad = await adminReject.POST(jsonReq('http://localhost/api/admin/review/revisions/' + rev.id + '/reject', 'POST', { reason: '' }), {
      params: Promise.resolve({ id: rev.id }),
    })
    expect(bad.status).toBe(400)

    const res = await adminReject.POST(jsonReq('http://localhost/api/admin/review/revisions/' + rev.id + '/reject', 'POST', { reason: ' need more ' }), {
      params: Promise.resolve({ id: rev.id }),
    })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.revision.status).toBe('rejected')
    expect(j.revision.rejectReason).toBe('need more')

    const active = await deps.revisionRepo.findActiveByArticleId(article.id)
    expect(active?.id).toBe(rev.id)
  })
})
