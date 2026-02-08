import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    article: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    articleRevision: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    translationTask: {
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

describe('GET /api/admin/dashboard/summary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns stats and queue for admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.article.count.mockImplementation((opts: any) => {
      if (opts?.where?.status === 'in_review') return Promise.resolve(5)
      if (opts?.where?.status === 'published') return Promise.resolve(42)
      return Promise.resolve(0)
    })
    mocks.prisma.articleRevision.count.mockResolvedValue(2)
    mocks.prisma.translationTask.count.mockResolvedValue(7)
    mocks.prisma.anime.count.mockResolvedValue(11)
    mocks.prisma.city.count.mockResolvedValue(13)
    mocks.prisma.user.count.mockResolvedValue(17)
    mocks.prisma.waitlistEntry.count.mockResolvedValue(19)

    mocks.prisma.article.findMany.mockResolvedValue([
      { id: 'a1', slug: 'post-a1', title: 'Article 1', status: 'in_review', updatedAt: new Date('2025-01-03T00:00:00.000Z') },
    ])
    mocks.prisma.articleRevision.findMany.mockResolvedValue([
      { id: 'r1', title: 'Revision 1', status: 'in_review', updatedAt: new Date('2025-01-04T00:00:00.000Z') },
    ])

    const handlers = await import('app/api/admin/dashboard/summary/route')
    const res = await handlers.GET()

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.stats).toMatchObject({
      pendingArticles: 5,
      pendingRevisions: 2,
      pendingReviewTotal: 7,
      readyTranslations: 7,
      publishedArticles: 42,
      animeCount: 11,
      cityCount: 13,
      userCount: 17,
      waitlistCount: 19,
    })
    expect(j.queue.total).toBe(7)
    expect(j.queue.items).toHaveLength(2)
    expect(j.queue.items[0]).toMatchObject({
      id: 'r1',
      kind: 'revision',
      href: '/admin/review/r1',
    })
    expect(j.queue.items[1]).toMatchObject({
      id: 'a1',
      kind: 'article',
      slug: 'post-a1',
      href: '/admin/review/a1',
    })

    const articleFindCall = mocks.prisma.article.findMany.mock.calls[0]?.[0]
    expect(articleFindCall?.select?.contentJson).toBeUndefined()
    expect(articleFindCall?.select?.contentHtml).toBeUndefined()

    const revisionFindCall = mocks.prisma.articleRevision.findMany.mock.calls[0]?.[0]
    expect(revisionFindCall?.select?.contentJson).toBeUndefined()
    expect(revisionFindCall?.select?.contentHtml).toBeUndefined()
  })

  it('forbids non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/dashboard/summary/route')
    const res = await handlers.GET()

    expect(res.status).toBe(403)
    expect(mocks.prisma.article.count).not.toHaveBeenCalled()
    expect(mocks.prisma.article.findMany).not.toHaveBeenCalled()
  })
})
