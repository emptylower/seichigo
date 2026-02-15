import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from 'next-auth'
import type { AiApiDeps } from '@/lib/ai/api'
import { createHandlers } from '@/lib/ai/handlers/assets'
import { InMemoryAssetRepo } from '@/lib/asset/repoMemory'

const ORIG_SEICHIGO_AI_API_KEY = process.env.SEICHIGO_AI_API_KEY
const ORIG_AI_API_KEY = process.env.AI_API_KEY

function makeImageFile(bytes: Uint8Array, opts?: { name?: string; type?: string }) {
  return new File([bytes as unknown as BlobPart], opts?.name ?? 'image.png', { type: opts?.type ?? 'image/png' })
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

function mockDeps(overrides: Partial<AiApiDeps> = {}) {
  return {
    repo: {} as any,
    getSession: vi.fn().mockResolvedValue(null),
    sanitizeHtml: vi.fn((html) => html),
    isAdminEmail: vi.fn().mockReturnValue(false),
    ...overrides,
  } satisfies AiApiDeps
}

afterEach(() => {
  if (ORIG_SEICHIGO_AI_API_KEY === undefined) delete process.env.SEICHIGO_AI_API_KEY
  else process.env.SEICHIGO_AI_API_KEY = ORIG_SEICHIGO_AI_API_KEY

  if (ORIG_AI_API_KEY === undefined) delete process.env.AI_API_KEY
  else process.env.AI_API_KEY = ORIG_AI_API_KEY

  vi.restoreAllMocks()
})

describe('AI assets handler', () => {
  it('uploads with token mode when ownerId header is provided', async () => {
    process.env.SEICHIGO_AI_API_KEY = 'token-123'
    delete process.env.AI_API_KEY

    const deps = mockDeps()
    const repo = new InMemoryAssetRepo()
    const handlers = createHandlers({ ...deps, assetRepo: repo })

    const form = new FormData()
    form.set('file', makeImageFile(new Uint8Array([1, 2, 3]), { type: 'image/png' }))
    const req = new Request('http://localhost/api/ai/assets', {
      method: 'POST',
      body: form,
      headers: {
        Authorization: 'Bearer token-123',
        'X-SEICHIGO-OWNER-ID': 'user-123',
      },
    })

    const res = await handlers.POST(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { id: string; url: string }
    const stored = await repo.findById(json.id)
    expect(stored?.ownerId).toBe('user-123')
    expect(json.url).toBe(`/assets/${json.id}`)
  })

  it('rejects token mode upload without ownerId', async () => {
    process.env.SEICHIGO_AI_API_KEY = 'token-abc'
    delete process.env.AI_API_KEY

    const deps = mockDeps()
    const repo = new InMemoryAssetRepo()
    const handlers = createHandlers({ ...deps, assetRepo: repo })

    const form = new FormData()
    form.set('file', makeImageFile(new Uint8Array([1, 2, 3]), { type: 'image/png' }))
    const req = new Request('http://localhost/api/ai/assets', {
      method: 'POST',
      body: form,
      headers: {
        Authorization: 'Bearer token-abc',
      },
    })

    const res = await handlers.POST(req)
    expect(res.status).toBe(400)
  })

  it('uploads with session mode and uses session user id as owner', async () => {
    delete process.env.SEICHIGO_AI_API_KEY
    delete process.env.AI_API_KEY

    const deps = mockDeps({
      getSession: vi.fn().mockResolvedValue(makeSession({ id: 'admin-1', email: 'admin@test.com' })),
      isAdminEmail: vi.fn().mockReturnValue(true),
    })
    const repo = new InMemoryAssetRepo()
    const handlers = createHandlers({ ...deps, assetRepo: repo })

    const form = new FormData()
    form.set('file', makeImageFile(new Uint8Array([7, 8, 9]), { type: 'image/png' }))
    const req = new Request('http://localhost/api/ai/assets', {
      method: 'POST',
      body: form,
    })

    const res = await handlers.POST(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { id: string; url: string }
    const stored = await repo.findById(json.id)
    expect(stored?.ownerId).toBe('admin-1')
  })
})
