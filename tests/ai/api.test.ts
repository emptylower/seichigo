import { describe, it, expect, vi } from 'vitest'
import { getAiApiDeps } from '@/lib/ai/api'
import type { AiApiDeps } from '@/lib/ai/api'
import { createHandlers } from '@/lib/ai/handlers/articles'
import { createHandlers as createArticleByIdHandlers } from '@/lib/ai/handlers/articleById'
import type { Session } from 'next-auth'
import type { Article } from '@/lib/article/repo'
import type { ArticleStatus } from '@/lib/article/workflow'

describe('getAiApiDeps', () => {
  it('returns valid deps object with required properties', async () => {
    const deps = await getAiApiDeps()

    expect(deps).toBeDefined()
    expect(deps.repo).toBeDefined()
    expect(typeof deps.getSession).toBe('function')
    expect(typeof deps.sanitizeHtml).toBe('function')
    expect(typeof deps.isAdminEmail).toBe('function')
  })

  it('caches deps on subsequent calls', async () => {
    const deps1 = await getAiApiDeps()
    const deps2 = await getAiApiDeps()

    expect(deps1).toBe(deps2)
  })
})

describe('AI Articles Handler', () => {
  function mockArticle(overrides: Partial<Article> = {}): Article {
    return {
      id: 'art-1',
      slug: 'test-article',
      language: 'zh',
      translationGroupId: null,
      authorId: 'user-1',
      title: 'Test Article',
      seoTitle: null,
      description: null,
      animeIds: [],
      city: null,
      routeLength: null,
      tags: [],
      cover: null,
      status: 'draft' as ArticleStatus,
      rejectReason: null,
      needsRevision: false,
      contentJson: null,
      contentHtml: '',
      publishedAt: null,
      lastApprovedAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      ...overrides,
    }
  }

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

  function mockAdminSession(): Session {
    return {
      user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin' },
      expires: '2099-01-01',
    }
  }

  function mockUserSession(): Session {
    return {
      user: { id: 'user-1', email: 'user@test.com', name: 'User' },
      expires: '2099-01-01',
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
          listByStatus: vi.fn().mockImplementation((status: ArticleStatus) => {
            return Promise.resolve(articles.filter((a) => a.status === status))
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
          listByStatus: vi
            .fn()
            .mockImplementation((status: ArticleStatus) => {
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
  function mockArticle(overrides: Partial<Article> = {}): Article {
    return {
      id: 'art-1',
      slug: 'test-article',
      language: 'zh',
      translationGroupId: null,
      authorId: 'user-1',
      title: 'Test Article',
      seoTitle: null,
      description: null,
      animeIds: [],
      city: null,
      routeLength: null,
      tags: [],
      cover: null,
      status: 'draft' as ArticleStatus,
      rejectReason: null,
      needsRevision: false,
      contentJson: null,
      contentHtml: '',
      publishedAt: null,
      lastApprovedAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      ...overrides,
    }
  }

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

  function mockAdminSession(): Session {
    return {
      user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin' },
      expires: '2099-01-01',
    }
  }

  function mockUserSession(): Session {
    return {
      user: { id: 'user-1', email: 'user@test.com', name: 'User' },
      expires: '2099-01-01',
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

describe('AI Article By ID Handler', () => {
  function mockArticle(overrides: Partial<Article> = {}): Article {
    return {
      id: 'art-1',
      slug: 'test-article',
      language: 'zh',
      translationGroupId: null,
      authorId: 'user-1',
      title: 'Test Article',
      seoTitle: null,
      description: null,
      animeIds: [],
      city: null,
      routeLength: null,
      tags: [],
      cover: null,
      status: 'draft' as ArticleStatus,
      rejectReason: null,
      needsRevision: false,
      contentJson: { type: 'doc', content: [] },
      contentHtml: '<p>Test content</p>',
      publishedAt: null,
      lastApprovedAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      ...overrides,
    }
  }

  function mockDepsForById(overrides: Partial<AiApiDeps> = {}): AiApiDeps {
    return {
      repo: {
        findById: vi.fn().mockResolvedValue(null),
      } as any,
      getSession: vi.fn().mockResolvedValue(null),
      sanitizeHtml: vi.fn((html) => html),
      isAdminEmail: vi.fn().mockReturnValue(false),
      ...overrides,
    }
  }

  function mockAdminSession(): Session {
    return {
      user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin' },
      expires: '2099-01-01',
    }
  }

  function mockUserSession(): Session {
    return {
      user: { id: 'user-1', email: 'user@test.com', name: 'User' },
      expires: '2099-01-01',
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
})
