import { describe, expect, it, vi } from 'vitest'
import type { AiApiDeps } from '@/lib/ai/api'
import { createHandlers } from '@/lib/ai/handlers/articles'
import { mockAdminSession, mockArticle, mockUserSession } from './helpers'

describe('AI Articles Handler', () => {
  function mockDeps(overrides: Partial<AiApiDeps> = {}): AiApiDeps {
    return {
      repo: {
        listByAuthor: vi.fn().mockResolvedValue([]),
        listByStatus: vi.fn().mockResolvedValue([]),
      } as any,
      getSession: vi.fn().mockResolvedValue(null),
      sanitizeHtml: vi.fn((html) => html),
      isAdminEmail: vi.fn().mockReturnValue(false),
      ...overrides,
    }
  }

  describe('GET /api/ai/articles', () => {
    it('returns 403 for non-admin users', async () => {
      const deps = mockDeps({
        getSession: vi.fn().mockResolvedValue(mockUserSession()),
        isAdminEmail: vi.fn().mockReturnValue(false),
      })

      const handlers = createHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles')
      const res = await handlers.GET(req)

      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.error).toBeDefined()
    })

    it('returns all articles for admin users', async () => {
      const articles = [
        mockArticle({ id: 'art-1', status: 'draft', authorId: 'user-1' }),
        mockArticle({ id: 'art-2', status: 'published', authorId: 'user-2' }),
        mockArticle({ id: 'art-3', status: 'in_review', authorId: 'user-1' }),
      ]

      const deps = mockDeps({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          listByStatus: vi.fn().mockImplementation((status) => {
            return Promise.resolve(articles.filter((article) => article.status === status))
          }),
        } as any,
      })

      const handlers = createHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles')
      const res = await handlers.GET(req)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.items).toHaveLength(3)
      expect(json.items[0]).not.toHaveProperty('contentJson')
      expect(json.items[0]).not.toHaveProperty('contentHtml')
    })

    it('filters by status when provided', async () => {
      const draftArticles = [
        mockArticle({ id: 'art-1', status: 'draft' }),
        mockArticle({ id: 'art-2', status: 'draft' }),
      ]

      const deps = mockDeps({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          listByStatus: vi.fn().mockResolvedValue(draftArticles),
        } as any,
      })

      const handlers = createHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles?status=draft')
      const res = await handlers.GET(req)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.items).toHaveLength(2)
      expect(deps.repo.listByStatus).toHaveBeenCalledWith('draft')
    })

    it('filters by language when provided', async () => {
      const zhArticles = [mockArticle({ id: 'art-1', language: 'zh' })]
      const enArticles = [mockArticle({ id: 'art-2', language: 'en' })]

      const deps = mockDeps({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          listByStatus: vi.fn().mockImplementation((status) => {
            if (status === 'draft') return Promise.resolve([...zhArticles, ...enArticles])
            return Promise.resolve([])
          }),
        } as any,
      })

      const handlers = createHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles?language=zh')
      const res = await handlers.GET(req)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.items).toHaveLength(1)
      expect(json.items[0].language).toBe('zh')
    })

    it('filters by authorId using memory filtering', async () => {
      const authorArticles = [
        mockArticle({ id: 'art-1', status: 'draft', authorId: 'user-1' }),
        mockArticle({ id: 'art-2', status: 'published', authorId: 'user-1' }),
      ]

      const deps = mockDeps({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          listByAuthor: vi.fn().mockResolvedValue(authorArticles),
        } as any,
      })

      const handlers = createHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles?authorId=user-1')
      const res = await handlers.GET(req)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.items).toHaveLength(2)
      expect(deps.repo.listByAuthor).toHaveBeenCalledWith('user-1')
    })

    it('combines authorId with status filter in memory', async () => {
      const authorArticles = [
        mockArticle({ id: 'art-1', status: 'draft', authorId: 'user-1' }),
        mockArticle({ id: 'art-2', status: 'published', authorId: 'user-1' }),
      ]

      const deps = mockDeps({
        getSession: vi.fn().mockResolvedValue(mockAdminSession()),
        isAdminEmail: vi.fn().mockReturnValue(true),
        repo: {
          listByAuthor: vi.fn().mockResolvedValue(authorArticles),
        } as any,
      })

      const handlers = createHandlers(deps)
      const req = new Request('http://localhost/api/ai/articles?authorId=user-1&status=draft')
      const res = await handlers.GET(req)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.items).toHaveLength(1)
      expect(json.items[0].id).toBe('art-1')
      expect(json.items[0].status).toBe('draft')
    })
  })
})

describe('POST /api/ai/articles', () => {
  function mockDeps(overrides: Partial<AiApiDeps> = {}): AiApiDeps {
    return {
      repo: {
        createDraft: vi.fn(),
      } as any,
      getSession: vi.fn().mockResolvedValue(null),
      sanitizeHtml: vi.fn((html) => html),
      isAdminEmail: vi.fn().mockReturnValue(false),
      ...overrides,
    }
  }

  it('returns 401 if not authenticated', async () => {
    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(null),
    })
    const handlers = createHandlers(deps)
    const req = new Request('http://localhost/api/ai/articles', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test Article' }),
    })

    const res = await handlers.POST(req)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBeDefined()
  })

  it('returns 403 for non-admin users', async () => {
    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(mockUserSession()),
      isAdminEmail: vi.fn().mockReturnValue(false),
    })
    const handlers = createHandlers(deps)
    const req = new Request('http://localhost/api/ai/articles', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test Article' }),
    })

    const res = await handlers.POST(req)
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toBeDefined()
  })

  it('returns 400 when title is missing', async () => {
    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(mockAdminSession()),
      isAdminEmail: vi.fn().mockReturnValue(true),
    })
    const handlers = createHandlers(deps)
    const req = new Request('http://localhost/api/ai/articles', {
      method: 'POST',
      body: JSON.stringify({ contentJson: { type: 'doc' } }),
    })

    const res = await handlers.POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
  })

  it('creates draft with contentJson for admin', async () => {
    const createdArticle = mockArticle({
      id: 'art-new',
      slug: 'test-article',
      title: 'Test Article',
      authorId: 'admin-1',
      contentJson: { type: 'doc', content: [] },
    })

    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(mockAdminSession()),
      isAdminEmail: vi.fn().mockReturnValue(true),
      repo: {
        createDraft: vi.fn().mockResolvedValue(createdArticle),
      } as any,
    })

    const handlers = createHandlers(deps)
    const req = new Request('http://localhost/api/ai/articles', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Article',
        contentJson: { type: 'doc', content: [] },
      }),
    })

    const res = await handlers.POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.article).toBeDefined()
    expect(deps.repo.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: 'admin-1',
        title: 'Test Article',
        contentJson: { type: 'doc', content: [] },
      })
    )
  })

  it('creates draft with contentHtml for admin', async () => {
    const createdArticle = mockArticle({
      id: 'art-new',
      slug: 'test-article',
      title: 'Test Article',
      authorId: 'admin-1',
      contentHtml: '<p>Test content</p>',
    })

    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(mockAdminSession()),
      isAdminEmail: vi.fn().mockReturnValue(true),
      repo: {
        createDraft: vi.fn().mockResolvedValue(createdArticle),
      } as any,
      sanitizeHtml: vi.fn((html) => html),
    })

    const handlers = createHandlers(deps)
    const req = new Request('http://localhost/api/ai/articles', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Article',
        contentHtml: '<p>Test content</p>',
      }),
    })

    const res = await handlers.POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(deps.sanitizeHtml).toHaveBeenCalledWith('<p>Test content</p>')
    expect(deps.repo.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: 'admin-1',
        title: 'Test Article',
        contentHtml: '<p>Test content</p>',
      })
    )
  })

  it('creates draft with both contentJson and contentHtml for admin', async () => {
    const createdArticle = mockArticle({
      id: 'art-new',
      slug: 'test-article',
      title: 'Test Article',
      authorId: 'admin-1',
      contentJson: { type: 'doc', content: [] },
      contentHtml: '<p>Test content</p>',
    })

    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(mockAdminSession()),
      isAdminEmail: vi.fn().mockReturnValue(true),
      repo: {
        createDraft: vi.fn().mockResolvedValue(createdArticle),
      } as any,
      sanitizeHtml: vi.fn((html) => html),
    })

    const handlers = createHandlers(deps)
    const req = new Request('http://localhost/api/ai/articles', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Article',
        contentJson: { type: 'doc', content: [] },
        contentHtml: '<p>Test content</p>',
      }),
    })

    const res = await handlers.POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(deps.repo.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: 'admin-1',
        title: 'Test Article',
        contentJson: { type: 'doc', content: [] },
        contentHtml: '<p>Test content</p>',
      })
    )
  })
})
