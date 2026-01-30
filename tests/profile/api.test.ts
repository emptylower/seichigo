import { describe, expect, it } from 'vitest'
import type { Session } from 'next-auth'
import type { ProfileData } from '@/lib/profile/types'
import type { ProfileRepo } from '@/lib/profile/repo'

// Mock ProfileRepo implementation for testing
class InMemoryProfileRepo implements ProfileRepo {
  private profiles = new Map<string, ProfileData>()

  async getProfile(userId: string): Promise<ProfileData | null> {
    return this.profiles.get(userId) ?? null
  }

  async updateProfile(userId: string, data: Partial<ProfileData>): Promise<ProfileData> {
    const existing = this.profiles.get(userId) ?? {
      name: null,
      image: null,
      bio: null,
      bilibili: null,
      weibo: null,
      github: null,
      twitter: null,
    }
    const updated = { ...existing, ...data }
    this.profiles.set(userId, updated)
    return updated
  }

  // Test helper
  seed(userId: string, data: ProfileData) {
    this.profiles.set(userId, data)
  }
}

type ProfileApiDeps = {
  repo: ProfileRepo
  getSession: () => Promise<Session | null>
}

function jsonReq(url: string, method: string, body?: any): Request {
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

function makeDeps(options?: {
  session?: Session | null
}): { deps: ProfileApiDeps; setSession: (s: Session | null) => void; repo: InMemoryProfileRepo } {
  let currentSession: Session | null = options?.session ?? null
  const repo = new InMemoryProfileRepo()

  const deps: ProfileApiDeps = {
    repo,
    getSession: async () => currentSession,
  }

  return { deps, setSession: (s) => (currentSession = s), repo }
}

describe('profile api', () => {
  it('GET /api/me/profile requires auth', async () => {
    const { deps } = makeDeps()
    
    // Import handlers (will fail until implemented)
    const { createHandlers } = await import('@/lib/profile/handlers')
    const handlers = createHandlers(deps)

    const res = await handlers.GET(jsonReq('http://localhost/api/me/profile', 'GET'))
    expect(res.status).toBe(401)
    
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it('GET /api/me/profile returns user profile data', async () => {
    const { deps, repo } = makeDeps({
      session: { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } } as Session
    })

    // Seed test data
    repo.seed('u1', {
      name: 'Test User',
      image: 'https://example.com/avatar.jpg',
      bio: 'This is my bio',
      bilibili: 'https://space.bilibili.com/123',
      weibo: 'https://weibo.com/test',
      github: 'https://github.com/testuser',
      twitter: 'https://twitter.com/testuser',
    })

    const { createHandlers } = await import('@/lib/profile/handlers')
    const handlers = createHandlers(deps)

    const res = await handlers.GET(jsonReq('http://localhost/api/me/profile', 'GET'))
    expect(res.status).toBe(200)

    const profile = await res.json()
    expect(profile.name).toBe('Test User')
    expect(profile.image).toBe('https://example.com/avatar.jpg')
    expect(profile.bio).toBe('This is my bio')
    expect(profile.bilibili).toBe('https://space.bilibili.com/123')
  })

  it('PATCH /api/me/profile requires auth', async () => {
    const { deps } = makeDeps()

    const { createHandlers } = await import('@/lib/profile/handlers')
    const handlers = createHandlers(deps)

    const res = await handlers.PATCH(jsonReq('http://localhost/api/me/profile', 'PATCH', { name: 'New Name' }))
    expect(res.status).toBe(401)
  })

  it('PATCH /api/me/profile updates name', async () => {
    const { deps, repo } = makeDeps({
      session: { user: { id: 'u1', name: 'Old Name', email: 'test@example.com' } } as Session
    })

    repo.seed('u1', {
      name: 'Old Name',
      image: null,
      bio: null,
      bilibili: null,
      weibo: null,
      github: null,
      twitter: null,
    })

    const { createHandlers } = await import('@/lib/profile/handlers')
    const handlers = createHandlers(deps)

    const res = await handlers.PATCH(jsonReq('http://localhost/api/me/profile', 'PATCH', { name: 'New Name' }))
    expect(res.status).toBe(200)

    const updated = await res.json()
    expect(updated.name).toBe('New Name')

    // Verify persisted
    const profile = await repo.getProfile('u1')
    expect(profile?.name).toBe('New Name')
  })

  it('PATCH /api/me/profile updates bio', async () => {
    const { deps, repo } = makeDeps({
      session: { user: { id: 'u1', name: 'User', email: 'test@example.com' } } as Session
    })

    repo.seed('u1', {
      name: 'User',
      image: null,
      bio: null,
      bilibili: null,
      weibo: null,
      github: null,
      twitter: null,
    })

    const { createHandlers } = await import('@/lib/profile/handlers')
    const handlers = createHandlers(deps)

    const res = await handlers.PATCH(jsonReq('http://localhost/api/me/profile', 'PATCH', { bio: 'My new bio' }))
    expect(res.status).toBe(200)

    const updated = await res.json()
    expect(updated.bio).toBe('My new bio')
  })

  it('PATCH /api/me/profile updates social links', async () => {
    const { deps, repo } = makeDeps({
      session: { user: { id: 'u1', name: 'User', email: 'test@example.com' } } as Session
    })

    repo.seed('u1', {
      name: 'User',
      image: null,
      bio: null,
      bilibili: null,
      weibo: null,
      github: null,
      twitter: null,
    })

    const { createHandlers } = await import('@/lib/profile/handlers')
    const handlers = createHandlers(deps)

    const res = await handlers.PATCH(jsonReq('http://localhost/api/me/profile', 'PATCH', {
      bilibili: 'https://space.bilibili.com/456',
      github: 'https://github.com/newuser',
    }))
    expect(res.status).toBe(200)

    const updated = await res.json()
    expect(updated.bilibili).toBe('https://space.bilibili.com/456')
    expect(updated.github).toBe('https://github.com/newuser')
    expect(updated.weibo).toBe(null) // Unchanged
  })

  it('PATCH /api/me/profile updates image (avatar URL)', async () => {
    const { deps, repo } = makeDeps({
      session: { user: { id: 'u1', name: 'User', email: 'test@example.com' } } as Session
    })

    repo.seed('u1', {
      name: 'User',
      image: null,
      bio: null,
      bilibili: null,
      weibo: null,
      github: null,
      twitter: null,
    })

    const { createHandlers } = await import('@/lib/profile/handlers')
    const handlers = createHandlers(deps)

    const res = await handlers.PATCH(jsonReq('http://localhost/api/me/profile', 'PATCH', {
      image: 'https://example.com/new-avatar.jpg',
    }))
    expect(res.status).toBe(200)

    const updated = await res.json()
    expect(updated.image).toBe('https://example.com/new-avatar.jpg')
  })

  it('PATCH /api/me/profile validates bio length', async () => {
    const { deps, repo } = makeDeps({
      session: { user: { id: 'u1', name: 'User', email: 'test@example.com' } } as Session
    })

    repo.seed('u1', {
      name: 'User',
      image: null,
      bio: null,
      bilibili: null,
      weibo: null,
      github: null,
      twitter: null,
    })

    const { createHandlers } = await import('@/lib/profile/handlers')
    const handlers = createHandlers(deps)

    // Create a bio longer than 500 characters
    const longBio = 'a'.repeat(501)

    const res = await handlers.PATCH(jsonReq('http://localhost/api/me/profile', 'PATCH', { bio: longBio }))
    expect(res.status).toBe(400)

    const json = await res.json()
    expect(json.error).toBeDefined()
  })
})
