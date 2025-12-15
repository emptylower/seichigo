import { describe, expect, it } from 'vitest'
import { InMemoryArticleRepo } from '@/lib/article/repoMemory'
import type { ArticleApiDeps } from '@/lib/article/api'

import { createHandlers as createArticlesHandlers } from '@/lib/article/handlers/articles'
import { createHandlers as createArticleHandlers } from '@/lib/article/handlers/articleById'
import { createHandlers as createSubmitHandlers } from '@/lib/article/handlers/submit'
import { createHandlers as createWithdrawHandlers } from '@/lib/article/handlers/withdraw'
import { createHandlers as createAdminReviewListHandlers } from '@/lib/article/handlers/adminReviewList'
import { createHandlers as createAdminApproveHandlers } from '@/lib/article/handlers/adminApprove'
import { createHandlers as createAdminRejectHandlers } from '@/lib/article/handlers/adminReject'

function jsonReq(url: string, method: string, body?: any): Request {
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

function makeDeps(options?: {
  session?: any
  mdxSlugs?: Set<string>
  now?: Date
}): { deps: ArticleApiDeps; setSession: (s: any) => void; mdxSlugs: Set<string> } {
  const now = options?.now ?? new Date('2025-01-01T00:00:00.000Z')
  const repo = new InMemoryArticleRepo({ now: () => now })

  let currentSession: any = options?.session ?? null
  const mdxSlugs = options?.mdxSlugs ?? new Set<string>()

  const deps: ArticleApiDeps = {
    repo,
    getSession: async () => currentSession,
    mdxSlugExists: async (slug) => mdxSlugs.has(slug),
    sanitizeHtml: (html) => `sanitized:${html}`,
    now: () => now,
  }

  return { deps, setSession: (s) => (currentSession = s), mdxSlugs }
}

describe('article api', () => {
  it('requires auth for author endpoints', async () => {
    const { deps } = makeDeps()
    const articles = createArticlesHandlers(deps)

    const r1 = await articles.POST(jsonReq('http://localhost/api/articles', 'POST', { title: 'A' }))
    expect(r1.status).toBe(401)

    const r2 = await articles.GET(jsonReq('http://localhost/api/articles?scope=mine', 'GET'))
    expect(r2.status).toBe(401)
  })

  it('creates draft and lists mine', async () => {
    const { deps, setSession } = makeDeps({
      session: { user: { id: 'user-1', isAdmin: false } },
    })

    const articles = createArticlesHandlers(deps)
    const createRes = await articles.POST(
      jsonReq('http://localhost/api/articles', 'POST', {
        title: 'My Article',
        contentHtml: '<p>hi</p>',
      })
    )
    expect(createRes.status).toBe(200)
    const created = await createRes.json()
    expect(created.ok).toBe(true)
    expect(created.article.status).toBe('draft')
    expect(created.article.slug).toBe('my-article')

    const listRes = await articles.GET(jsonReq('http://localhost/api/articles?scope=mine', 'GET'))
    const list = await listRes.json()
    expect(list.ok).toBe(true)
    expect(list.items).toHaveLength(1)

    // other user sees nothing
    setSession({ user: { id: 'user-2', isAdmin: false } })
    const listRes2 = await articles.GET(jsonReq('http://localhost/api/articles?scope=mine', 'GET'))
    const list2 = await listRes2.json()
    expect(list2.ok).toBe(true)
    expect(list2.items).toHaveLength(0)
  })

  it('auto-generates slug when not provided', async () => {
    const fixedNow = new Date('2025-01-01T00:00:00.000Z')
    const { deps } = makeDeps({
      now: fixedNow,
      session: { user: { id: 'user-1', isAdmin: false } },
    })

    const articles = createArticlesHandlers(deps)

    const r1 = await articles.POST(jsonReq('http://localhost/api/articles', 'POST', { title: 'My First Article' }))
    expect(r1.status).toBe(200)
    const j1 = await r1.json()
    expect(j1.article.slug).toBe('my-first-article')

    const r2 = await articles.POST(jsonReq('http://localhost/api/articles', 'POST', { title: 'My First Article' }))
    expect(r2.status).toBe(200)
    const j2 = await r2.json()
    expect(j2.article.slug).toBe('my-first-article-2')
  })

  it('detail is visible to author or admin only', async () => {
    const { deps, setSession } = makeDeps({
      session: { user: { id: 'user-1', isAdmin: false } },
    })
    const articles = createArticlesHandlers(deps)
    const articleIdHandlers = createArticleHandlers(deps)

    const createRes = await articles.POST(jsonReq('http://localhost/api/articles', 'POST', { title: 'A' }))
    const created = await createRes.json()
    const id = created.article.id as string

    // other user forbidden
    setSession({ user: { id: 'user-2', isAdmin: false } })
    const r1 = await articleIdHandlers.GET(jsonReq('http://localhost/api/articles/' + id, 'GET'), { params: Promise.resolve({ id }) })
    expect(r1.status).toBe(403)

    // admin allowed
    setSession({ user: { id: 'admin-1', isAdmin: true } })
    const r2 = await articleIdHandlers.GET(jsonReq('http://localhost/api/articles/' + id, 'GET'), { params: Promise.resolve({ id }) })
    expect(r2.status).toBe(200)
  })

  it('patch works in draft; fails in in_review', async () => {
    const { deps, setSession } = makeDeps({
      session: { user: { id: 'user-1', isAdmin: false } },
    })
    const articles = createArticlesHandlers(deps)
    const articleIdHandlers = createArticleHandlers(deps)
    const submit = createSubmitHandlers(deps)

    const createRes = await articles.POST(jsonReq('http://localhost/api/articles', 'POST', { title: 'A' }))
    const created = await createRes.json()
    const id = created.article.id as string

    const patchRes = await articleIdHandlers.PATCH(
      jsonReq('http://localhost/api/articles/' + id, 'PATCH', {
        title: 'A2',
        animeIds: ['btr'],
        contentHtml: `<p>${'x'.repeat(120)}</p>`,
      }),
      { params: Promise.resolve({ id }) }
    )
    expect(patchRes.status).toBe(200)
    const patched = await patchRes.json()
    expect(patched.article.title).toBe('A2')
    expect(patched.article.slug).toBe('a2')

    const submitRes = await submit.POST(jsonReq('http://localhost/api/articles/' + id + '/submit', 'POST'), {
      params: Promise.resolve({ id }),
    })
    expect(submitRes.status).toBe(200)

    const patchRes2 = await articleIdHandlers.PATCH(
      jsonReq('http://localhost/api/articles/' + id, 'PATCH', { title: 'A3' }),
      { params: Promise.resolve({ id }) }
    )
    expect(patchRes2.status).toBe(409)

    // admin still cannot patch (forbidden)
    setSession({ user: { id: 'admin-1', isAdmin: true } })
    const patchRes3 = await articleIdHandlers.PATCH(
      jsonReq('http://localhost/api/articles/' + id, 'PATCH', { title: 'A4' }),
      { params: Promise.resolve({ id }) }
    )
    expect(patchRes3.status).toBe(403)
  })

  it('allows author to delete draft; disallows delete after submit', async () => {
    const { deps, setSession } = makeDeps({
      session: { user: { id: 'user-1', isAdmin: false } },
    })

    const articles = createArticlesHandlers(deps)
    const articleIdHandlers = createArticleHandlers(deps)
    const submit = createSubmitHandlers(deps)

    const createRes = await articles.POST(jsonReq('http://localhost/api/articles', 'POST', { title: 'A' }))
    const created = await createRes.json()
    const id = created.article.id as string

    const delRes = await articleIdHandlers.DELETE(jsonReq('http://localhost/api/articles/' + id, 'DELETE'), { params: Promise.resolve({ id }) })
    expect(delRes.status).toBe(200)

    const listRes = await articles.GET(jsonReq('http://localhost/api/articles?scope=mine', 'GET'))
    const list = await listRes.json()
    expect(list.items).toHaveLength(0)

    // Create again and submit to in_review
    const createRes2 = await articles.POST(jsonReq('http://localhost/api/articles', 'POST', { title: 'B' }))
    const created2 = await createRes2.json()
    const id2 = created2.article.id as string

    const patchReady = await articleIdHandlers.PATCH(
      jsonReq('http://localhost/api/articles/' + id2, 'PATCH', { animeIds: ['btr'], contentHtml: `<p>${'x'.repeat(120)}</p>` }),
      { params: Promise.resolve({ id: id2 }) }
    )
    expect(patchReady.status).toBe(200)

    const submitRes = await submit.POST(jsonReq('http://localhost/api/articles/' + id2 + '/submit', 'POST'), {
      params: Promise.resolve({ id: id2 }),
    })
    expect(submitRes.status).toBe(200)

    const delAfterSubmit = await articleIdHandlers.DELETE(jsonReq('http://localhost/api/articles/' + id2, 'DELETE'), { params: Promise.resolve({ id: id2 }) })
    expect(delAfterSubmit.status).toBe(409)

    // other user cannot delete
    setSession({ user: { id: 'user-2', isAdmin: false } })
    const delForbidden = await articleIdHandlers.DELETE(jsonReq('http://localhost/api/articles/' + id2, 'DELETE'), { params: Promise.resolve({ id: id2 }) })
    expect(delForbidden.status).toBe(403)
  })

  it('submit/withdraw/reject/approve transitions follow workflow rules', async () => {
    const fixedNow = new Date('2025-01-01T00:00:00.000Z')
    const { deps, setSession } = makeDeps({
      now: fixedNow,
      session: { user: { id: 'user-1', isAdmin: false } },
    })

    const articles = createArticlesHandlers(deps)
    const submit = createSubmitHandlers(deps)
    const withdraw = createWithdrawHandlers(deps)
    const adminList = createAdminReviewListHandlers(deps)
    const adminReject = createAdminRejectHandlers(deps)
    const adminApprove = createAdminApproveHandlers(deps)

    const createRes = await articles.POST(jsonReq('http://localhost/api/articles', 'POST', { title: 'A' }))
    const created = await createRes.json()
    const id = created.article.id as string

    const patchReady = await createArticleHandlers(deps).PATCH(
      jsonReq('http://localhost/api/articles/' + id, 'PATCH', { animeIds: ['btr'], contentHtml: `<p>${'x'.repeat(120)}</p>` }),
      { params: Promise.resolve({ id }) }
    )
    expect(patchReady.status).toBe(200)

    // submit -> in_review
    const submitRes = await submit.POST(jsonReq('http://localhost/api/articles/' + id + '/submit', 'POST'), {
      params: Promise.resolve({ id }),
    })
    expect(submitRes.status).toBe(200)

    // author can withdraw -> draft
    const withdrawRes = await withdraw.POST(jsonReq('http://localhost/api/articles/' + id + '/withdraw', 'POST'), {
      params: Promise.resolve({ id }),
    })
    expect(withdrawRes.status).toBe(200)

    // resubmit
    const submitRes2 = await submit.POST(jsonReq('http://localhost/api/articles/' + id + '/submit', 'POST'), {
      params: Promise.resolve({ id }),
    })
    expect(submitRes2.status).toBe(200)

    // non-admin cannot access admin review list
    const listForbidden = await adminList.GET(jsonReq('http://localhost/api/admin/review/articles?status=in_review', 'GET'))
    expect(listForbidden.status).toBe(403)

    // admin sees in_review
    setSession({ user: { id: 'admin-1', isAdmin: true } })
    const listRes = await adminList.GET(jsonReq('http://localhost/api/admin/review/articles?status=in_review', 'GET'))
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list.items.map((x: any) => x.id)).toContain(id)

    // reject requires reason
    const rejectBad = await adminReject.POST(
      jsonReq('http://localhost/api/admin/review/articles/' + id + '/reject', 'POST', { reason: '' }),
      { params: Promise.resolve({ id }) }
    )
    expect(rejectBad.status).toBe(400)

    const rejectRes = await adminReject.POST(
      jsonReq('http://localhost/api/admin/review/articles/' + id + '/reject', 'POST', { reason: 'needs more detail' }),
      { params: Promise.resolve({ id }) }
    )
    expect(rejectRes.status).toBe(200)
    const rejected = await rejectRes.json()
    expect(rejected.article.status).toBe('rejected')
    expect(rejected.article.rejectReason).toBe('needs more detail')

    // author can edit + resubmit after rejection
    setSession({ user: { id: 'user-1', isAdmin: false } })
    const submitAfterReject = await submit.POST(jsonReq('http://localhost/api/articles/' + id + '/submit', 'POST'), {
      params: Promise.resolve({ id }),
    })
    expect(submitAfterReject.status).toBe(200)

    // admin approve -> published with publishedAt
    setSession({ user: { id: 'admin-1', isAdmin: true } })
    const approveRes = await adminApprove.POST(jsonReq('http://localhost/api/admin/review/articles/' + id + '/approve', 'POST'), {
      params: Promise.resolve({ id }),
    })
    expect(approveRes.status).toBe(200)
    const approved = await approveRes.json()
    expect(approved.article.status).toBe('published')
    expect(approved.article.publishedAt).toBe(fixedNow.toISOString())
  })

  it('disallows manual slug and keeps slug unique on title changes', async () => {
    const { deps } = makeDeps({
      session: { user: { id: 'user-1', isAdmin: false } },
    })

    const articles = createArticlesHandlers(deps)
    const articleIdHandlers = createArticleHandlers(deps)

    const manualCreate = await articles.POST(jsonReq('http://localhost/api/articles', 'POST', { slug: 'manual', title: 'Hello' }))
    expect(manualCreate.status).toBe(400)

    const a1 = await articles.POST(jsonReq('http://localhost/api/articles', 'POST', { title: 'Hello' }))
    expect(a1.status).toBe(200)
    const a1j = await a1.json()
    const id1 = a1j.article.id as string
    expect(a1j.article.slug).toBe('hello')

    const a2 = await articles.POST(jsonReq('http://localhost/api/articles', 'POST', { title: 'World' }))
    expect(a2.status).toBe(200)
    const a2j = await a2.json()
    const id2 = a2j.article.id as string
    expect(a2j.article.slug).toBe('world')

    const manualPatch = await articleIdHandlers.PATCH(jsonReq('http://localhost/api/articles/' + id2, 'PATCH', { slug: 'hack' }), {
      params: Promise.resolve({ id: id2 }),
    })
    expect(manualPatch.status).toBe(400)

    const patchTitle = await articleIdHandlers.PATCH(jsonReq('http://localhost/api/articles/' + id2, 'PATCH', { title: 'Hello' }), {
      params: Promise.resolve({ id: id2 }),
    })
    expect(patchTitle.status).toBe(200)
    const patched = await patchTitle.json()
    expect(patched.article.title).toBe('Hello')
    expect(patched.article.slug).toBe('hello-2')

    // sanity: id1 exists
    expect(id1).toBeTruthy()
  })
})
