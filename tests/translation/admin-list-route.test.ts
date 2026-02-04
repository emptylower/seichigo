import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    translationTask: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    article: {
      findMany: vi.fn(),
    },
    city: {
      findMany: vi.fn(),
    },
    anime: {
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

function getReq(url: string): Request {
  return new Request(url, { method: 'GET' })
}

describe('GET /api/admin/translations', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns compact list items with subject/target and pagination', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.translationTask.findMany.mockResolvedValue([
      {
        id: 't1',
        entityType: 'article',
        entityId: 'a1',
        targetLanguage: 'ja',
        status: 'approved',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
        error: null,
      },
    ])
    mocks.prisma.translationTask.count.mockResolvedValue(1)

    mocks.prisma.article.findMany.mockImplementation((opts: any) => {
      if (opts?.where?.id?.in) {
        return Promise.resolve([{ id: 'a1', title: '中文标题', slug: 'demo-slug' }])
      }
      if (opts?.where?.translationGroupId?.in) {
        return Promise.resolve([
          {
            id: 'a1-ja',
            title: '日本語タイトル',
            slug: 'demo-slug',
            status: 'published',
            publishedAt: new Date('2024-01-03T00:00:00.000Z'),
            updatedAt: new Date('2024-01-04T00:00:00.000Z'),
            language: 'ja',
            translationGroupId: 'a1',
          },
        ])
      }
      return Promise.resolve([])
    })
    mocks.prisma.city.findMany.mockResolvedValue([])
    mocks.prisma.anime.findMany.mockResolvedValue([])

    const handlers = await import('app/api/admin/translations/route')
    const res = await handlers.GET(getReq('http://localhost/api/admin/translations?status=approved&page=2&pageSize=20') as any)

    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j.total).toBe(1)
    expect(j.page).toBe(2)
    expect(j.pageSize).toBe(20)

    expect(j.tasks).toHaveLength(1)
    expect(j.tasks[0]).toMatchObject({
      id: 't1',
      entityType: 'article',
      entityId: 'a1',
      targetLanguage: 'ja',
      status: 'approved',
      subject: { title: '中文标题', slug: 'demo-slug' },
      target: { title: '日本語タイトル', slug: 'demo-slug', status: 'published' },
    })

    const call = (mocks.prisma.translationTask.findMany as any).mock.calls[0]?.[0]
    expect(call).toMatchObject({
      orderBy: { updatedAt: 'desc' },
      skip: 20,
      take: 20,
    })

    expect(call.select).toEqual({
      id: true,
      entityType: true,
      entityId: true,
      targetLanguage: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      error: true,
    })
  })

  it('builds OR search filters from entity matches', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.translationTask.findMany.mockResolvedValue([])
    mocks.prisma.translationTask.count.mockResolvedValue(0)

    mocks.prisma.article.findMany.mockImplementation((opts: any) => {
      if (opts?.where?.OR && opts?.select?.translationGroupId) {
        return Promise.resolve([{ id: 'a1', translationGroupId: null }])
      }
      return Promise.resolve([])
    })
    mocks.prisma.city.findMany.mockResolvedValue([])
    mocks.prisma.anime.findMany.mockResolvedValue([])

    const handlers = await import('app/api/admin/translations/route')
    const res = await handlers.GET(getReq('http://localhost/api/admin/translations?q=hello') as any)

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.tasks).toEqual([])

    const call = (mocks.prisma.translationTask.findMany as any).mock.calls[0]?.[0]
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        { id: { contains: 'hello', mode: 'insensitive' } },
        { entityId: { contains: 'hello', mode: 'insensitive' } },
        { AND: [{ entityType: 'article' }, { entityId: { in: ['a1'] } }] },
      ])
    )
  })
})

