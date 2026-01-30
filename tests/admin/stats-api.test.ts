import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    article: {
      count: vi.fn(),
    },
    anime: {
      count: vi.fn(),
    },
    city: {
      count: vi.fn(),
    },
    user: {
      count: vi.fn(),
    },
    waitlistEntry: {
      count: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

describe('admin stats api', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 6 stats for admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.article.count.mockImplementation((opts: any) => {
      if (opts?.where?.status === 'in_review') return Promise.resolve(5)
      if (opts?.where?.status === 'published') return Promise.resolve(42)
      return Promise.resolve(0)
    })
    mocks.prisma.anime.count.mockResolvedValue(12)
    mocks.prisma.city.count.mockResolvedValue(8)
    mocks.prisma.user.count.mockResolvedValue(100)
    mocks.prisma.waitlistEntry.count.mockResolvedValue(23)

    const handlers = await import('app/api/admin/stats/route')
    const res = await handlers.GET()

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.stats).toEqual({
      pendingArticles: 5,
      publishedArticles: 42,
      animeCount: 12,
      cityCount: 8,
      userCount: 100,
      waitlistCount: 23,
    })

    expect(mocks.prisma.article.count).toHaveBeenCalledWith({ where: { status: 'in_review' } })
    expect(mocks.prisma.article.count).toHaveBeenCalledWith({ where: { status: 'published' } })
    expect(mocks.prisma.anime.count).toHaveBeenCalledWith({ where: { hidden: false } })
    expect(mocks.prisma.city.count).toHaveBeenCalledWith({ where: { hidden: false } })
    expect(mocks.prisma.user.count).toHaveBeenCalledWith()
    expect(mocks.prisma.waitlistEntry.count).toHaveBeenCalledWith()
  })

  it('forbids non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/stats/route')
    const res = await handlers.GET()

    expect(res.status).toBe(403)
    const j = await res.json()
    expect(j.error).toBe('Forbidden')

    expect(mocks.prisma.article.count).not.toHaveBeenCalled()
    expect(mocks.prisma.anime.count).not.toHaveBeenCalled()
    expect(mocks.prisma.city.count).not.toHaveBeenCalled()
    expect(mocks.prisma.user.count).not.toHaveBeenCalled()
    expect(mocks.prisma.waitlistEntry.count).not.toHaveBeenCalled()
  })

  it('forbids unauthenticated', async () => {
    mocks.getSession.mockResolvedValue(null)

    const handlers = await import('app/api/admin/stats/route')
    const res = await handlers.GET()

    expect(res.status).toBe(403)
    expect(mocks.prisma.article.count).not.toHaveBeenCalled()
  })
})
