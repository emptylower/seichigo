import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDeps: vi.fn(),
  getSession: vi.fn(),
  listPage: vi.fn(),
}))

vi.mock('@/lib/waitlist/api', () => ({
  getWaitlistApiDeps: () => mocks.getDeps(),
}))

function req(url: string): Request {
  return new Request(url, { method: 'GET' })
}

describe('GET /api/admin/waitlist', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getDeps.mockResolvedValue({
      repo: { listPage: mocks.listPage },
      getSession: mocks.getSession,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    })
  })

  it('returns paginated waitlist entries for admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.listPage.mockResolvedValue({
      items: [{ userId: 'u1', email: 'u1@example.com', createdAt: new Date('2025-01-02T00:00:00.000Z') }],
      total: 31,
      page: 2,
      pageSize: 15,
    })

    const handlers = await import('app/api/admin/waitlist/route')
    const res = await handlers.GET(req('http://localhost/api/admin/waitlist?page=2&pageSize=15&q=u1'))

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.items).toEqual([
      {
        userId: 'u1',
        email: 'u1@example.com',
        createdAt: '2025-01-02T00:00:00.000Z',
      },
    ])
    expect(j.total).toBe(31)
    expect(j.page).toBe(2)
    expect(j.pageSize).toBe(15)
    expect(mocks.listPage).toHaveBeenCalledWith({ page: 2, pageSize: 15, q: 'u1' })
  })

  it('returns 401 for unauthenticated user', async () => {
    mocks.getSession.mockResolvedValue(null)

    const handlers = await import('app/api/admin/waitlist/route')
    const res = await handlers.GET(req('http://localhost/api/admin/waitlist'))

    expect(res.status).toBe(401)
    expect(mocks.listPage).not.toHaveBeenCalled()
  })

  it('returns 403 for non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/waitlist/route')
    const res = await handlers.GET(req('http://localhost/api/admin/waitlist'))

    expect(res.status).toBe(403)
    expect(mocks.listPage).not.toHaveBeenCalled()
  })
})
