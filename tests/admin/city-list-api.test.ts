import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  countPostsByCityIds: vi.fn(),
  prisma: {
    city: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/city/db', () => ({
  countPublishedArticlesByCityIds: (...args: any[]) => mocks.countPostsByCityIds(...args),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

function req(url: string): Request {
  return new Request(url, { method: 'GET' })
}

describe('GET /api/admin/city', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns paginated city list for admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.city.findMany.mockResolvedValue([
      {
        id: 'tokyo',
        slug: 'tokyo',
        name_zh: '东京',
        name_en: 'Tokyo',
        name_ja: '東京',
        cover: null,
        needsReview: false,
        hidden: false,
        _count: { aliases: 2 },
      },
    ])
    mocks.prisma.city.count.mockResolvedValue(21)
    mocks.countPostsByCityIds.mockResolvedValue({ tokyo: 7 })

    const handlers = await import('app/api/admin/city/route')
    const res = await handlers.GET(req('http://localhost/api/admin/city?page=2&pageSize=10&q=tokyo'))

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.total).toBe(21)
    expect(j.page).toBe(2)
    expect(j.pageSize).toBe(10)
    expect(j.items).toEqual([
      expect.objectContaining({
        id: 'tokyo',
        slug: 'tokyo',
        aliasCount: 2,
        postCount: 7,
      }),
    ])

    const findCall = mocks.prisma.city.findMany.mock.calls[0]?.[0]
    expect(findCall?.skip).toBe(10)
    expect(findCall?.take).toBe(10)
    expect(findCall?.where?.OR).toBeDefined()
    expect(mocks.countPostsByCityIds).toHaveBeenCalledWith(['tokyo'])
  })

  it('forbids non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/city/route')
    const res = await handlers.GET(req('http://localhost/api/admin/city'))

    expect(res.status).toBe(403)
    expect(mocks.prisma.city.findMany).not.toHaveBeenCalled()
  })
})
