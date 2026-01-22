import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAnimeById: vi.fn(),
  prisma: {
    anime: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/anime/getAllAnime', () => ({
  getAnimeById: (...args: any[]) => mocks.getAnimeById(...args),
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

describe('admin anime api', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('allows admin to rename anime via PATCH', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.getAnimeById.mockResolvedValue({ id: 'btr', name: 'File Name', cover: null, summary: null, hidden: false })
    mocks.prisma.anime.upsert.mockResolvedValue({ id: 'btr', name: 'New Name', cover: null, summary: null, hidden: false })

    const handlers = await import('app/api/admin/anime/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/anime/btr', 'PATCH', { name: ' New Name ' }), {
      params: Promise.resolve({ id: 'btr' }),
    })

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.anime.name).toBe('New Name')

    expect(mocks.prisma.anime.upsert).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.anime.upsert.mock.calls[0]?.[0]
    expect(call.update.name).toBe('New Name')
    expect(call.create.name).toBe('New Name')
  })

  it('rejects empty name', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const handlers = await import('app/api/admin/anime/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/anime/btr', 'PATCH', { name: '   ' }), {
      params: Promise.resolve({ id: 'btr' }),
    })

    expect(res.status).toBe(400)
    expect(mocks.getAnimeById).not.toHaveBeenCalled()
    expect(mocks.prisma.anime.upsert).not.toHaveBeenCalled()
  })

  it('forbids non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/anime/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/anime/btr', 'PATCH', { name: 'X' }), {
      params: Promise.resolve({ id: 'btr' }),
    })

    expect(res.status).toBe(403)
    expect(mocks.getAnimeById).not.toHaveBeenCalled()
    expect(mocks.prisma.anime.upsert).not.toHaveBeenCalled()
  })
})
