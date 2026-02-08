import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAllAnime: vi.fn(),
  prisma: {
    anime: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/anime/getAllAnime', () => ({
  getAllAnime: (...args: any[]) => mocks.getAllAnime(...args),
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

describe('public anime api', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.DATABASE_URL = 'mock'
  })

  it('maps known chinese title to english slug id on create', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.prisma.anime.findUnique.mockResolvedValue(null)
    mocks.prisma.anime.create.mockResolvedValue({ id: 'weathering-with-you', name: '天气之子' })

    const handlers = await import('app/api/anime/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/anime', 'POST', { id: '天气之子', name: '天气之子' }))

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.anime.id).toBe('weathering-with-you')
    expect(mocks.prisma.anime.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'weathering-with-you',
          name: '天气之子',
        }),
      })
    )
  })

  it('returns existing anime when mapped id already exists', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.prisma.anime.findUnique.mockResolvedValue({ id: 'weathering-with-you', name: '天气之子' })

    const handlers = await import('app/api/anime/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/anime', 'POST', { id: '天气之子', name: '天气之子' }))

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.anime.id).toBe('weathering-with-you')
    expect(mocks.prisma.anime.create).not.toHaveBeenCalled()
  })

  it('rejects unknown non-ascii id creation', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })

    const handlers = await import('app/api/anime/route')
    const res = await handlers.POST(jsonReq('http://localhost/api/anime', 'POST', { id: '未收录作品', name: '未收录作品' }))

    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error).toContain('英文作品 ID')
    expect(mocks.prisma.anime.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.anime.create).not.toHaveBeenCalled()
  })
})
