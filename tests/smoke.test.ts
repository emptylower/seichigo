import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '@/lib/auth/admin'
import { InMemoryArticleRepo } from '@/lib/article/repoMemory'
import type { ArticleApiDeps } from '@/lib/article/api'
import { createHandlers as createAdminArticlesListHandlers } from '@/lib/article/handlers/adminArticlesList'

describe('smoke', () => {
  it('hashPassword and verifyPassword work', () => {
    const password = 'test-password-123'
    const hash = hashPassword(password)
    expect(hash).toMatch(/^scrypt\$/)
    expect(verifyPassword(password, hash)).toBe(true)
    expect(verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('admin articles list returns JSON 401/403 (never HTML) when not authorized', async () => {
    let session: any = null
    const repo = new InMemoryArticleRepo({ now: () => new Date('2025-01-01T00:00:00.000Z') })

    const deps: ArticleApiDeps = {
      repo,
      getSession: async () => session,
      mdxSlugExists: async () => false,
      sanitizeHtml: (html) => html,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    }

    const handlers = createAdminArticlesListHandlers(deps)

    const unauth = await handlers.GET(new Request('http://localhost/api/admin/articles'))
    expect(unauth.status).toBe(401)
    expect(unauth.headers.get('content-type') || '').toContain('application/json')

    const unauthWithQuery = await handlers.GET(new Request('http://localhost/api/admin/articles?status=draft&language=zh'))
    expect(unauthWithQuery.status).toBe(401)
    expect(unauthWithQuery.headers.get('content-type') || '').toContain('application/json')

    session = { user: { id: 'user-1', isAdmin: false } }
    const forbidden = await handlers.GET(new Request('http://localhost/api/admin/articles?status=draft&language=zh'))
    expect(forbidden.status).toBe(403)
    expect(forbidden.headers.get('content-type') || '').toContain('application/json')
  })
})
