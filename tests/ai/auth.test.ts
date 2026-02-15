import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from 'next-auth'
import type { AiApiDeps } from '@/lib/ai/api'
import { authorizeAiRequest } from '@/lib/ai/auth'

const ORIG_SEICHIGO_AI_API_KEY = process.env.SEICHIGO_AI_API_KEY
const ORIG_AI_API_KEY = process.env.AI_API_KEY

function mockDeps(overrides: Partial<AiApiDeps> = {}): AiApiDeps {
  return {
    repo: {} as any,
    getSession: vi.fn().mockResolvedValue(null),
    sanitizeHtml: vi.fn((html) => html),
    isAdminEmail: vi.fn().mockReturnValue(false),
    ...overrides,
  }
}

function makeSession(user: { id: string; email: string }): Session {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: 'tester',
    },
    expires: '2099-01-01',
  }
}

afterEach(() => {
  if (ORIG_SEICHIGO_AI_API_KEY === undefined) delete process.env.SEICHIGO_AI_API_KEY
  else process.env.SEICHIGO_AI_API_KEY = ORIG_SEICHIGO_AI_API_KEY

  if (ORIG_AI_API_KEY === undefined) delete process.env.AI_API_KEY
  else process.env.AI_API_KEY = ORIG_AI_API_KEY

  vi.restoreAllMocks()
})

describe('authorizeAiRequest', () => {
  it('authorizes with Bearer token and skips session lookup', async () => {
    process.env.SEICHIGO_AI_API_KEY = 'token-123'
    delete process.env.AI_API_KEY

    const getSession = vi.fn().mockResolvedValue(null)
    const deps = mockDeps({ getSession })
    const req = new Request('http://localhost/api/ai/articles', {
      headers: { Authorization: 'Bearer token-123' },
    })

    const auth = await authorizeAiRequest(req, deps)
    expect(auth).toEqual({ ok: true, mode: 'token' })
    expect(getSession).not.toHaveBeenCalled()
  })

  it('authorizes with X-AI-KEY token', async () => {
    process.env.SEICHIGO_AI_API_KEY = 'token-abc'
    delete process.env.AI_API_KEY

    const deps = mockDeps()
    const req = new Request('http://localhost/api/ai/articles', {
      headers: { 'X-AI-KEY': 'token-abc' },
    })

    const auth = await authorizeAiRequest(req, deps)
    expect(auth).toEqual({ ok: true, mode: 'token' })
  })

  it('falls back to admin session when token is invalid', async () => {
    process.env.SEICHIGO_AI_API_KEY = 'token-right'
    delete process.env.AI_API_KEY

    const adminSession = makeSession({ id: 'admin-1', email: 'admin@test.com' })
    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(adminSession),
      isAdminEmail: vi.fn().mockReturnValue(true),
    })
    const req = new Request('http://localhost/api/ai/articles', {
      headers: { Authorization: 'Bearer token-wrong' },
    })

    const auth = await authorizeAiRequest(req, deps)
    expect(auth).toEqual({ ok: true, mode: 'session', session: adminSession })
  })

  it('returns forbidden for non-admin session', async () => {
    delete process.env.SEICHIGO_AI_API_KEY
    delete process.env.AI_API_KEY

    const userSession = makeSession({ id: 'user-1', email: 'user@test.com' })
    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(userSession),
      isAdminEmail: vi.fn().mockReturnValue(false),
    })
    const req = new Request('http://localhost/api/ai/articles')

    const auth = await authorizeAiRequest(req, deps)
    expect(auth).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('returns unauthorized when no token and no session', async () => {
    delete process.env.SEICHIGO_AI_API_KEY
    delete process.env.AI_API_KEY

    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(null),
    })
    const req = new Request('http://localhost/api/ai/articles')

    const auth = await authorizeAiRequest(req, deps)
    expect(auth).toEqual({ ok: false, reason: 'unauthorized' })
  })
})
