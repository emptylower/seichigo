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
  },
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

function req(url: string): Request {
  return new Request(url, { method: 'GET' })
}

describe('GET /api/admin/review/queue', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns merged in_review queue with pagination', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.article.count.mockResolvedValue(2)
    mocks.prisma.articleRevision.count.mockResolvedValue(1)
    mocks.prisma.article.findMany.mockResolvedValue([
      { id: 'a2', slug: 'a2', title: 'Article 2', status: 'in_review', updatedAt: new Date('2025-01-03T00:00:00.000Z') },
      { id: 'a1', slug: 'a1', title: 'Article 1', status: 'in_review', updatedAt: new Date('2025-01-01T00:00:00.000Z') },
    ])
    mocks.prisma.articleRevision.findMany.mockResolvedValue([
      { id: 'r1', articleId: 'a1', title: 'Revision 1', status: 'in_review', updatedAt: new Date('2025-01-02T00:00:00.000Z') },
    ])

    const handlers = await import('app/api/admin/review/queue/route')
    const res = await handlers.GET(req('http://localhost/api/admin/review/queue?status=in_review&page=1&pageSize=5'))

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.status).toBe('in_review')
    expect(j.total).toBe(3)
    expect(j.page).toBe(1)
    expect(j.pageSize).toBe(5)
    expect(j.items).toHaveLength(3)
    expect(j.items[0]).toMatchObject({ id: 'a2', kind: 'article', slug: 'a2' })
    expect(j.items[1]).toMatchObject({ id: 'r1', kind: 'revision', articleId: 'a1', slug: null })
    expect(j.items[2]).toMatchObject({ id: 'a1', kind: 'article', slug: 'a1' })

    const articleCall = mocks.prisma.article.findMany.mock.calls[0]?.[0]
    expect(articleCall?.select?.contentJson).toBeUndefined()
    expect(articleCall?.select?.contentHtml).toBeUndefined()
    const revisionCall = mocks.prisma.articleRevision.findMany.mock.calls[0]?.[0]
    expect(revisionCall?.select?.contentJson).toBeUndefined()
    expect(revisionCall?.select?.contentHtml).toBeUndefined()
  })

  it('returns paginated published queue', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.article.count.mockResolvedValue(3)
    mocks.prisma.article.findMany.mockResolvedValue([
      { id: 'a2', slug: 'a2', title: 'Published 2', status: 'published', updatedAt: new Date('2025-01-03T00:00:00.000Z') },
    ])

    const handlers = await import('app/api/admin/review/queue/route')
    const res = await handlers.GET(req('http://localhost/api/admin/review/queue?status=published&page=1&pageSize=5'))

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.status).toBe('published')
    expect(j.total).toBe(3)
    expect(j.page).toBe(1)
    expect(j.pageSize).toBe(5)
    expect(j.items).toEqual([
      expect.objectContaining({
        id: 'a2',
        kind: 'article',
        articleId: 'a2',
        slug: 'a2',
      }),
    ])

    expect(mocks.prisma.articleRevision.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.articleRevision.count).not.toHaveBeenCalled()
  })

  it('forbids non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/review/queue/route')
    const res = await handlers.GET(req('http://localhost/api/admin/review/queue'))

    expect(res.status).toBe(403)
    expect(mocks.prisma.article.findMany).not.toHaveBeenCalled()
  })
})
