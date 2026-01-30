import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    article: {
      findMany: vi.fn(),
    },
    favorite: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

function jsonReq(url: string, method: string, body?: any): Request {
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('admin users api', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('GET /api/admin/users', () => {
    it('returns paginated user list for admin', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          email: 'user1@example.com',
          name: 'User One',
          isAdmin: false,
          disabled: false,
          createdAt: new Date('2024-01-01'),
          _count: { articles: 5 },
        },
        {
          id: 'user-2',
          email: 'user2@example.com',
          name: 'User Two',
          isAdmin: true,
          disabled: false,
          createdAt: new Date('2024-01-02'),
          _count: { articles: 3 },
        },
      ])
      mocks.prisma.user.count.mockResolvedValue(2)

      const handlers = await import('app/api/admin/users/route')
      const res = await handlers.GET(jsonReq('http://localhost/api/admin/users?page=1', 'GET'))

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.ok).toBe(true)
      expect(j.users).toHaveLength(2)
      expect(j.users[0].articleCount).toBe(5)
      expect(j.total).toBe(2)
      expect(j.page).toBe(1)
      expect(j.pageSize).toBe(20)
    })

    it('supports search by email', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          email: 'alice@example.com',
          name: 'Alice',
          isAdmin: false,
          disabled: false,
          createdAt: new Date('2024-01-01'),
          _count: { articles: 2 },
        },
      ])
      mocks.prisma.user.count.mockResolvedValue(1)

      const handlers = await import('app/api/admin/users/route')
      const res = await handlers.GET(jsonReq('http://localhost/api/admin/users?q=alice', 'GET'))

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.ok).toBe(true)
      expect(j.users).toHaveLength(1)
      expect(j.users[0].email).toBe('alice@example.com')

      const call = mocks.prisma.user.findMany.mock.calls[0]?.[0]
      expect(call.where.OR).toBeDefined()
      expect(call.where.OR[0].email.contains).toBe('alice')
    })

    it('forbids non-admin', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

      const handlers = await import('app/api/admin/users/route')
      const res = await handlers.GET(jsonReq('http://localhost/api/admin/users', 'GET'))

      expect(res.status).toBe(403)
      expect(mocks.prisma.user.findMany).not.toHaveBeenCalled()
    })

    it('forbids unauthenticated', async () => {
      mocks.getSession.mockResolvedValue(null)

      const handlers = await import('app/api/admin/users/route')
      const res = await handlers.GET(jsonReq('http://localhost/api/admin/users', 'GET'))

      expect(res.status).toBe(403)
      expect(mocks.prisma.user.findMany).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/admin/users/[id]', () => {
    it('returns user details with articles, drafts, and favorites', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User One',
        isAdmin: false,
        disabled: false,
        createdAt: new Date('2024-01-01'),
      })
      mocks.prisma.article.findMany
        .mockResolvedValueOnce([
          {
            id: 'article-1',
            slug: 'article-1',
            title: 'Published Article',
            status: 'published',
            publishedAt: new Date('2024-01-10'),
            createdAt: new Date('2024-01-05'),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'article-2',
            slug: 'article-2',
            title: 'Draft Article',
            status: 'draft',
            createdAt: new Date('2024-01-06'),
            updatedAt: new Date('2024-01-07'),
          },
        ])
      mocks.prisma.favorite.findMany.mockResolvedValue([
        {
          articleId: 'fav-1',
          createdAt: new Date('2024-01-08'),
          article: {
            id: 'fav-1',
            slug: 'fav-1',
            title: 'Favorite Article',
            status: 'published',
          },
        },
      ])

      const handlers = await import('app/api/admin/users/[id]/route')
      const res = await handlers.GET(jsonReq('http://localhost/api/admin/users/user-1', 'GET'), {
        params: Promise.resolve({ id: 'user-1' }),
      })

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.ok).toBe(true)
      expect(j.user.id).toBe('user-1')
      expect(j.articles).toHaveLength(1)
      expect(j.drafts).toHaveLength(1)
      expect(j.favorites).toHaveLength(1)
    })

    it('returns 404 for non-existent user', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.user.findUnique.mockResolvedValue(null)

      const handlers = await import('app/api/admin/users/[id]/route')
      const res = await handlers.GET(jsonReq('http://localhost/api/admin/users/nonexistent', 'GET'), {
        params: Promise.resolve({ id: 'nonexistent' }),
      })

      expect(res.status).toBe(404)
    })

    it('forbids non-admin', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

      const handlers = await import('app/api/admin/users/[id]/route')
      const res = await handlers.GET(jsonReq('http://localhost/api/admin/users/user-1', 'GET'), {
        params: Promise.resolve({ id: 'user-1' }),
      })

      expect(res.status).toBe(403)
      expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /api/admin/users/[id]', () => {
    it('updates isAdmin field', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User One',
        isAdmin: true,
        disabled: false,
        createdAt: new Date('2024-01-01'),
      })

      const handlers = await import('app/api/admin/users/[id]/route')
      const res = await handlers.PATCH(
        jsonReq('http://localhost/api/admin/users/user-1', 'PATCH', { isAdmin: true }),
        { params: Promise.resolve({ id: 'user-1' }) }
      )

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.ok).toBe(true)
      expect(j.user.isAdmin).toBe(true)

      const call = mocks.prisma.user.update.mock.calls[0]?.[0]
      expect(call.data.isAdmin).toBe(true)
    })

    it('updates disabled field', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User One',
        isAdmin: false,
        disabled: true,
        createdAt: new Date('2024-01-01'),
      })

      const handlers = await import('app/api/admin/users/[id]/route')
      const res = await handlers.PATCH(
        jsonReq('http://localhost/api/admin/users/user-1', 'PATCH', { disabled: true }),
        { params: Promise.resolve({ id: 'user-1' }) }
      )

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.ok).toBe(true)
      expect(j.user.disabled).toBe(true)
    })

    it('updates both fields', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User One',
        isAdmin: true,
        disabled: true,
        createdAt: new Date('2024-01-01'),
      })

      const handlers = await import('app/api/admin/users/[id]/route')
      const res = await handlers.PATCH(
        jsonReq('http://localhost/api/admin/users/user-1', 'PATCH', { isAdmin: true, disabled: true }),
        { params: Promise.resolve({ id: 'user-1' }) }
      )

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.ok).toBe(true)
      expect(j.user.isAdmin).toBe(true)
      expect(j.user.disabled).toBe(true)
    })

    it('rejects empty update', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

      const handlers = await import('app/api/admin/users/[id]/route')
      const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/users/user-1', 'PATCH', {}), {
        params: Promise.resolve({ id: 'user-1' }),
      })

      expect(res.status).toBe(400)
      expect(mocks.prisma.user.update).not.toHaveBeenCalled()
    })

    it('ignores invalid fields', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User One',
        isAdmin: true,
        disabled: false,
        createdAt: new Date('2024-01-01'),
      })

      const handlers = await import('app/api/admin/users/[id]/route')
      const res = await handlers.PATCH(
        jsonReq('http://localhost/api/admin/users/user-1', 'PATCH', { isAdmin: true, email: 'hacker@evil.com' }),
        { params: Promise.resolve({ id: 'user-1' }) }
      )

      expect(res.status).toBe(200)
      const call = mocks.prisma.user.update.mock.calls[0]?.[0]
      expect(call.data.isAdmin).toBe(true)
      expect(call.data.email).toBeUndefined()
    })

    it('returns 404 for non-existent user', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.user.update.mockRejectedValue({ code: 'P2025' })

      const handlers = await import('app/api/admin/users/[id]/route')
      const res = await handlers.PATCH(
        jsonReq('http://localhost/api/admin/users/nonexistent', 'PATCH', { isAdmin: true }),
        { params: Promise.resolve({ id: 'nonexistent' }) }
      )

      expect(res.status).toBe(404)
    })

    it('forbids non-admin', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

      const handlers = await import('app/api/admin/users/[id]/route')
      const res = await handlers.PATCH(
        jsonReq('http://localhost/api/admin/users/user-1', 'PATCH', { isAdmin: true }),
        { params: Promise.resolve({ id: 'user-1' }) }
      )

      expect(res.status).toBe(403)
      expect(mocks.prisma.user.update).not.toHaveBeenCalled()
    })
  })
})
