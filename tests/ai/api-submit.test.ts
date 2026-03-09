import { describe, expect, it, vi } from 'vitest'
import type { AiApiDeps } from '@/lib/ai/api'
import { createHandlers as createSubmitHandlers } from '@/lib/ai/handlers/submit'
import { mockAdminSession, mockArticle, mockUserSession } from './helpers'

describe('AI Submit Handler', () => {
  function mockDepsForSubmit(overrides: Partial<AiApiDeps> = {}): AiApiDeps {
    return {
      repo: {
        findById: vi.fn().mockResolvedValue(null),
        updateState: vi.fn().mockResolvedValue(null),
      } as any,
      getSession: vi.fn().mockResolvedValue(null),
      sanitizeHtml: vi.fn((html) => html),
      isAdminEmail: vi.fn().mockReturnValue(false),
      ...overrides,
    }
  }

  describe('POST', () => {
    it('returns 401 if not authenticated', async () => {
      const deps = mockDepsForSubmit({
        getSession: vi.fn().mockResolvedValue(null),
      })
      const handlers = createSubmitHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123/submit', { method: 'POST' })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.POST(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(401)
      expect(json.error).toBeDefined()
    })

    it('returns 403 if user is not admin', async () => {
      const deps = mockDepsForSubmit({
        getSession: vi.fn().mockResolvedValue(mockUserSession()),
        isAdminEmail: vi.fn().mockReturnValue(false),
      })
      const handlers = createSubmitHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123/submit', { method: 'POST' })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.POST(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(403)
      expect(json.error).toBeDefined()
    })

    it('returns 404 if article not found', async () => {
      const deps = mockDepsForSubmit({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(null),
          updateState: vi.fn(),
        } as any,
      })
      const handlers = createSubmitHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123/submit', { method: 'POST' })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.POST(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(404)
      expect(json.error).toBeDefined()
    })

    it('admin can submit draft article for review', async () => {
      const draftArticle = mockArticle({ id: 'art-123', status: 'draft' })
      const reviewArticle = mockArticle({ id: 'art-123', status: 'in_review', rejectReason: null })

      const deps = mockDepsForSubmit({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(draftArticle),
          updateState: vi.fn().mockResolvedValue(reviewArticle),
        } as any,
      })
      const handlers = createSubmitHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123/submit', { method: 'POST' })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.POST(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.article.status).toBe('in_review')
      expect(deps.repo.updateState).toHaveBeenCalledWith('art-123', { status: 'in_review', rejectReason: null })
    })

    it('admin can submit rejected article for review', async () => {
      const rejectedArticle = mockArticle({ id: 'art-123', status: 'rejected', rejectReason: 'Too short' })
      const reviewArticle = mockArticle({ id: 'art-123', status: 'in_review', rejectReason: null })

      const deps = mockDepsForSubmit({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(rejectedArticle),
          updateState: vi.fn().mockResolvedValue(reviewArticle),
        } as any,
      })
      const handlers = createSubmitHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123/submit', { method: 'POST' })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.POST(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.article.status).toBe('in_review')
      expect(deps.repo.updateState).toHaveBeenCalledWith('art-123', { status: 'in_review', rejectReason: null })
    })

    it('returns 409 if article is already in_review', async () => {
      const reviewArticle = mockArticle({ id: 'art-123', status: 'in_review' })

      const deps = mockDepsForSubmit({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(reviewArticle),
          updateState: vi.fn(),
        } as any,
      })
      const handlers = createSubmitHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123/submit', { method: 'POST' })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.POST(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(409)
      expect(json.error).toBeDefined()
      expect(deps.repo.updateState).not.toHaveBeenCalled()
    })

    it('returns 409 if article is published', async () => {
      const publishedArticle = mockArticle({ id: 'art-123', status: 'published', publishedAt: new Date() })

      const deps = mockDepsForSubmit({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(publishedArticle),
          updateState: vi.fn(),
        } as any,
      })
      const handlers = createSubmitHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123/submit', { method: 'POST' })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.POST(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(409)
      expect(json.error).toBeDefined()
      expect(deps.repo.updateState).not.toHaveBeenCalled()
    })

    it('admin can submit any article (not just their own)', async () => {
      const draftArticle = mockArticle({ id: 'art-123', status: 'draft', authorId: 'different-user' })
      const reviewArticle = mockArticle({ id: 'art-123', status: 'in_review', authorId: 'different-user' })

      const deps = mockDepsForSubmit({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          findById: vi.fn().mockResolvedValue(draftArticle),
          updateState: vi.fn().mockResolvedValue(reviewArticle),
        } as any,
      })
      const handlers = createSubmitHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles/art-123/submit', { method: 'POST' })
      const ctx = { params: Promise.resolve({ id: 'art-123' }) }

      const res = await handlers.POST(req, ctx)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.article.authorId).toBe('different-user')
    })
  })
})
