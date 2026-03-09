import { describe, expect, it, vi } from 'vitest'
import { getAiApiDeps, type AiApiDeps } from '@/lib/ai/api'
import { createHandlers as createRootHandlers } from '@/lib/ai/handlers/root'
import { createHandlers as createNotFoundHandlers } from '@/lib/ai/handlers/notFound'
import { mockAdminSession, mockUserSession } from './helpers'

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

describe('AI Root Handler', () => {
  function mockDeps(overrides: Partial<AiApiDeps> = {}): AiApiDeps {
    return {
      repo: {} as any,
      getSession: vi.fn().mockResolvedValue(null),
      sanitizeHtml: vi.fn((html) => html),
      isAdminEmail: vi.fn().mockReturnValue(false),
      ...overrides,
    }
  }

  it('returns 401 when not authenticated', async () => {
    const deps = mockDeps({ getSession: vi.fn().mockResolvedValue(null) })
    const res = await createRootHandlers(deps).GET(new Request('http://localhost/api/ai'))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it('returns 403 when not admin', async () => {
    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(mockUserSession()),
      isAdminEmail: vi.fn().mockReturnValue(false),
    })
    const res = await createRootHandlers(deps).GET(new Request('http://localhost/api/ai'))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it('returns 200 and endpoints for admin', async () => {
    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(mockAdminSession()),
      isAdminEmail: vi.fn().mockReturnValue(true),
    })
    const res = await createRootHandlers(deps).GET(new Request('http://localhost/api/ai'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.endpoints).toBeDefined()
    expect(json.endpoints.assets).toBe('/api/ai/assets')
    expect(json.baseUrl).toBe('/api/ai')
  })
})

describe('AI Not Found Handler', () => {
  function mockDeps(overrides: Partial<AiApiDeps> = {}): AiApiDeps {
    return {
      repo: {} as any,
      getSession: vi.fn().mockResolvedValue(null),
      sanitizeHtml: vi.fn((html) => html),
      isAdminEmail: vi.fn().mockReturnValue(false),
      ...overrides,
    }
  }

  it('returns JSON 404 for unknown /api/ai/* path when admin', async () => {
    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(mockAdminSession()),
      isAdminEmail: vi.fn().mockReturnValue(true),
    })
    const handlers = createNotFoundHandlers(deps)
    const req = new Request('http://localhost/api/ai/nope/xyz')
    const ctx = { params: Promise.resolve({ path: ['nope', 'xyz'] }) }
    const res = await handlers.GET(req, ctx)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Not Found')
    expect(json.path).toBe('/api/ai/nope/xyz')
  })
})
