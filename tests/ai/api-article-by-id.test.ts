import { describe, expect, it, vi } from 'vitest'
import type { AiApiDeps } from '@/lib/ai/api'
import { createHandlers as createArticleByIdHandlers } from '@/lib/ai/handlers/articleById'
import { mockAdminSession, mockArticle, mockUserSession } from './helpers'

describe('AI Article By ID Handler', () => {
  function mockDepsForById(overrides: Partial<AiApiDeps> = {}): AiApiDeps {
    return {
      repo: {
        findById: vi.fn().mockResolvedValue(null),
        updateDraft: vi.fn().mockResolvedValue(null),
      } as any,
      getSession: vi.fn().mockResolvedValue(null),
      sanitizeHtml: vi.fn((html) => html),
      isAdminEmail: vi.fn().mockReturnValue(false),
      ...overrides,
    }
  }

  describe('GET', () => {
    it('returns 401 if not authenticated', async () => {
      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(null),
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123')
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.GET(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error).toBeDefined()
    })

    it('returns 403 if user is not admin', async () => {
      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockUserSession()),
        isAdminEmail: vi.fn().mockReturnValue(false),
        repo: {
          findById: vi.fn().mockResolvedValue(mockArticle()),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123')
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.GET(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(403)
      expect(json.error).toBeDefined()
    })

    it('returns 404 if article not found', async () => {
      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(null),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123')
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.GET(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(404)
      expect(json.error).toBeDefined()
    })

    it('returns full article detail with contentJson and contentHtml for admin', async () => {
      const article = mockArticle({
        id: 'art-123',
        contentJson: { type: 'doc', content: [] },
        contentHtml: '<p>Test content</p>',
      })

      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(article),
        } as any,
        sanitizeHtml: vi.fn((html) => `sanitized:${html}`),
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123')
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.GET(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.article).toBeDefined()
      expect(json.article.id).toBe('art-123')
      expect(json.article.contentJson).toEqual({ type: 'doc', content: [] })
      expect(json.article.contentHtml).toContain('sanitized:')
      expect(deps.sanitizeHtml).toHaveBeenCalledWith('<p>Test content</p>')
    })

    it('admin can access any article regardless of author', async () => {
      const article = mockArticle({
        id: 'art-123',
        authorId: 'different-user',
      })

      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(article),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123')
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.GET(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.article.authorId).toBe('different-user')
    })
  })

  describe('PATCH /api/ai/articles/[id]', () => {
    it('returns 401 if not authenticated', async () => {
      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(null),
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
      })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.PATCH(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error).toBeDefined()
    })

    it('returns 403 if user is not admin', async () => {
      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockUserSession()),
        isAdminEmail: vi.fn().mockReturnValue(false),
        repo: {
          findById: vi.fn().mockResolvedValue(mockArticle()),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
      })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.PATCH(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(403)
      expect(json.error).toBeDefined()
    })

    it('returns 404 if article not found', async () => {
      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(null),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
      })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.PATCH(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(404)
      expect(json.error).toBeDefined()
    })

    it('admin can update draft article', async () => {
      const originalArticle = mockArticle({
        id: 'art-123',
        status: 'draft',
        title: 'Original Title',
        authorId: 'different-user',
      })
      const updatedArticle = { ...originalArticle, title: 'Updated Title' }

      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(originalArticle),
          updateDraft: vi.fn().mockResolvedValue(updatedArticle),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
      })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.PATCH(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.article.title).toBe('Updated Title')
      expect(deps.repo.updateDraft).toHaveBeenCalledWith(
        'art-123',
        expect.objectContaining({ title: 'Updated Title' })
      )
    })

    it('admin can update rejected article', async () => {
      const originalArticle = mockArticle({
        id: 'art-123',
        status: 'rejected',
        title: 'Original Title',
      })
      const updatedArticle = { ...originalArticle, title: 'Updated Title' }

      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(originalArticle),
          updateDraft: vi.fn().mockResolvedValue(updatedArticle),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
      })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.PATCH(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.article.title).toBe('Updated Title')
    })

    it('returns 409 if trying to update published article', async () => {
      const publishedArticle = mockArticle({
        id: 'art-123',
        status: 'published',
      })

      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(publishedArticle),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
      })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.PATCH(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(409)
      expect(json.error).toBeDefined()
    })

    it('returns 409 if trying to update in_review article', async () => {
      const inReviewArticle = mockArticle({
        id: 'art-123',
        status: 'in_review',
      })

      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(inReviewArticle),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
      })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.PATCH(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(409)
      expect(json.error).toBeDefined()
    })

    it('sanitizes contentHtml before updating', async () => {
      const originalArticle = mockArticle({
        id: 'art-123',
        status: 'draft',
      })
      const updatedArticle = {
        ...originalArticle,
        contentHtml: 'sanitized:<p>Test</p>',
      }

      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(originalArticle),
          updateDraft: vi.fn().mockResolvedValue(updatedArticle),
        } as any,
        sanitizeHtml: vi.fn((html) => `sanitized:${html}`),
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123', {
        method: 'PATCH',
        body: JSON.stringify({ contentHtml: '<p>Test</p>' }),
      })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.PATCH(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(deps.sanitizeHtml).toHaveBeenCalledWith('<p>Test</p>')
      expect(deps.repo.updateDraft).toHaveBeenCalledWith(
        'art-123',
        expect.objectContaining({ contentHtml: 'sanitized:<p>Test</p>' })
      )
    })

    it('returns 400 if no fields to update', async () => {
      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(mockArticle({ status: 'draft' })),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123', {
        method: 'PATCH',
        body: JSON.stringify({}),
      })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.PATCH(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toBeDefined()
    })

    it('returns 400 if trying to update slug', async () => {
      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(mockArticle({ status: 'draft' })),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123', {
        method: 'PATCH',
        body: JSON.stringify({ slug: 'new-slug' }),
      })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.PATCH(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('slug')
    })

    it('supports updating multiple fields at once', async () => {
      const originalArticle = mockArticle({
        id: 'art-123',
        status: 'draft',
        title: 'Old Title',
        description: 'Old description',
        tags: ['old'],
      })
      const updatedArticle = {
        ...originalArticle,
        title: 'New Title',
        description: 'New description',
        tags: ['new', 'test'],
      }

      const deps = mockDepsForById({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(originalArticle),
          updateDraft: vi.fn().mockResolvedValue(updatedArticle),
        } as any,
      })
      const handlers = createArticleByIdHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123', {
        method: 'PATCH',
        body: JSON.stringify({
          title: 'New Title',
          description: 'New description',
          tags: ['new', 'test'],
        }),
      })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.PATCH(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.article.title).toBe('New Title')
      expect(json.article.description).toBe('New description')
      expect(json.article.tags).toEqual(['new', 'test'])
    })
  })
})
