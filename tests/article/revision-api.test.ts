import { describe, expect, it } from 'vitest'
import { InMemoryArticleRepo } from '@/lib/article/repoMemory'
import { InMemoryArticleRevisionRepo } from '@/lib/articleRevision/repoMemory'
import type { ArticleRevisionApiDeps } from '@/lib/articleRevision/api'

import { createHandlers as createCreateRevisionHandlers } from '@/lib/articleRevision/handlers/createFromArticle'
import { createHandlers as createRevisionHandlers } from '@/lib/articleRevision/handlers/revisionById'
import { createHandlers as createRevisionSubmitHandlers } from '@/lib/articleRevision/handlers/submit'
import { createHandlers as createRevisionWithdrawHandlers } from '@/lib/articleRevision/handlers/withdraw'

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

describe('article revision api', () => {
  it('requires auth for revision endpoints', async () => {
    const { deps } = makeDeps()
    const createRevision = createCreateRevisionHandlers(deps)
    const rev = createRevisionHandlers(deps)

    const r1 = await createRevision.POST(jsonReq('http://localhost/api/articles/a1/revision', 'POST'), { params: Promise.resolve({ id: 'a1' }) })
    expect(r1.status).toBe(401)

    const r2 = await rev.GET(jsonReq('http://localhost/api/revisions/r1', 'GET'), { params: Promise.resolve({ id: 'r1' }) })
    expect(r2.status).toBe(401)
  })

  it('creates active revision from published article (idempotent)', async () => {
    const { deps } = makeDeps({
      session: { user: { id: 'user-1', isAdmin: false } },
    })

    const article = await deps.articleRepo.createDraft({
      authorId: 'user-1',
      slug: 'btr-hello',
      title: 'Hello',
      animeIds: ['btr'],
      contentHtml: `<p>${'x'.repeat(120)}</p>`,
    })
    await deps.articleRepo.updateState(article.id, { status: 'published', publishedAt: deps.now() })

    const createRevision = createCreateRevisionHandlers(deps)

    const r1 = await createRevision.POST(jsonReq('http://localhost/api/articles/' + article.id + '/revision', 'POST'), {
      params: Promise.resolve({ id: article.id }),
    })
    expect(r1.status).toBe(200)
    const j1 = await r1.json()
    expect(j1.ok).toBe(true)
    expect(j1.revision.status).toBe('draft')

    const r2 = await createRevision.POST(jsonReq('http://localhost/api/articles/' + article.id + '/revision', 'POST'), {
      params: Promise.resolve({ id: article.id }),
    })
    const j2 = await r2.json()
    expect(j2.revision.id).toBe(j1.revision.id)
  })

  it('forbids non-author and blocks non-published article', async () => {
    const { deps, setSession } = makeDeps({
      session: { user: { id: 'user-1', isAdmin: false } },
    })

    const article = await deps.articleRepo.createDraft({
      authorId: 'user-1',
      slug: 'btr-hello',
      title: 'Hello',
      animeIds: ['btr'],
      contentHtml: `<p>${'x'.repeat(120)}</p>`,
    })

    const createRevision = createCreateRevisionHandlers(deps)

    // not published yet
    const r1 = await createRevision.POST(jsonReq('http://localhost/api/articles/' + article.id + '/revision', 'POST'), { params: Promise.resolve({ id: article.id }) })
    expect(r1.status).toBe(409)

    // other user forbidden even when published
    await deps.articleRepo.updateState(article.id, { status: 'published', publishedAt: deps.now() })
    setSession({ user: { id: 'user-2', isAdmin: false } })
    const r2 = await createRevision.POST(jsonReq('http://localhost/api/articles/' + article.id + '/revision', 'POST'), { params: Promise.resolve({ id: article.id }) })
    expect(r2.status).toBe(403)
  })

  it('patch works in draft; fails in in_review; admin cannot patch', async () => {
    const { deps, setSession } = makeDeps({
      session: { user: { id: 'user-1', isAdmin: false } },
    })

    const article = await deps.articleRepo.createDraft({
      authorId: 'user-1',
      slug: 'btr-hello',
      title: 'Hello',
      animeIds: ['btr'],
      contentHtml: `<p>${'x'.repeat(120)}</p>`,
    })
    await deps.articleRepo.updateState(article.id, { status: 'published', publishedAt: deps.now() })

    const createRevision = createCreateRevisionHandlers(deps)
    const created = await createRevision.POST(jsonReq('http://localhost/api/articles/' + article.id + '/revision', 'POST'), { params: Promise.resolve({ id: article.id }) })
    const createdJ = await created.json()
    const revisionId = createdJ.revision.id as string

    const revision = createRevisionHandlers(deps)
    const submit = createRevisionSubmitHandlers(deps)

    const patchRes = await revision.PATCH(jsonReq('http://localhost/api/revisions/' + revisionId, 'PATCH', { title: 'Hello v2' }), {
      params: Promise.resolve({ id: revisionId }),
    })
    expect(patchRes.status).toBe(200)
    const patched = await patchRes.json()
    expect(patched.revision.title).toBe('Hello v2')

    // author who is also admin can still patch
    setSession({ user: { id: 'user-1', isAdmin: true } })
    const patchResAdminAuthor = await revision.PATCH(jsonReq('http://localhost/api/revisions/' + revisionId, 'PATCH', { title: 'Hello v2 admin' }), {
      params: Promise.resolve({ id: revisionId }),
    })
    expect(patchResAdminAuthor.status).toBe(200)

    const submitRes = await submit.POST(jsonReq('http://localhost/api/revisions/' + revisionId + '/submit', 'POST'), { params: Promise.resolve({ id: revisionId }) })
    expect(submitRes.status).toBe(200)

    const patchRes2 = await revision.PATCH(jsonReq('http://localhost/api/revisions/' + revisionId, 'PATCH', { title: 'Hello v3' }), {
      params: Promise.resolve({ id: revisionId }),
    })
    expect(patchRes2.status).toBe(409)

    // admin still cannot patch
    setSession({ user: { id: 'admin-1', isAdmin: true } })
    const patchRes3 = await revision.PATCH(jsonReq('http://localhost/api/revisions/' + revisionId, 'PATCH', { title: 'Hello v4' }), {
      params: Promise.resolve({ id: revisionId }),
    })
    expect(patchRes3.status).toBe(403)
  })

  it('submit/withdraw transitions follow workflow rules', async () => {
    const { deps, setSession } = makeDeps({
      session: { user: { id: 'user-1', isAdmin: false } },
    })

    const article = await deps.articleRepo.createDraft({
      authorId: 'user-1',
      slug: 'btr-hello',
      title: 'Hello',
      animeIds: ['btr'],
      contentHtml: `<p>${'x'.repeat(120)}</p>`,
    })
    await deps.articleRepo.updateState(article.id, { status: 'published', publishedAt: deps.now() })

    const createRevision = createCreateRevisionHandlers(deps)
    const created = await createRevision.POST(jsonReq('http://localhost/api/articles/' + article.id + '/revision', 'POST'), { params: Promise.resolve({ id: article.id }) })
    const createdJ = await created.json()
    const revisionId = createdJ.revision.id as string

    const submit = createRevisionSubmitHandlers(deps)
    const withdraw = createRevisionWithdrawHandlers(deps)

    const submitRes = await submit.POST(jsonReq('http://localhost/api/revisions/' + revisionId + '/submit', 'POST'), { params: Promise.resolve({ id: revisionId }) })
    expect(submitRes.status).toBe(200)

    const withdrawRes = await withdraw.POST(jsonReq('http://localhost/api/revisions/' + revisionId + '/withdraw', 'POST'), { params: Promise.resolve({ id: revisionId }) })
    expect(withdrawRes.status).toBe(200)

    // other user forbidden
    setSession({ user: { id: 'user-2', isAdmin: false } })
    const withdrawForbidden = await withdraw.POST(jsonReq('http://localhost/api/revisions/' + revisionId + '/withdraw', 'POST'), { params: Promise.resolve({ id: revisionId }) })
    expect(withdrawForbidden.status).toBe(403)
  })
})
