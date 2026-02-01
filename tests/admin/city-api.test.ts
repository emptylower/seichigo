import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    city: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

function jsonReq(url: string, method: string, body?: any): Request {
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('admin city api - japanese fields', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('accepts description_ja field', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.city.findUnique.mockResolvedValue({ id: 'tokyo', slug: 'tokyo' })
    mocks.prisma.city.update.mockResolvedValue({ 
      id: 'tokyo', 
      slug: 'tokyo',
      description_ja: '日本語の説明',
      aliases: []
    })

    const handlers = await import('app/api/admin/city/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/city/tokyo', 'PATCH', { 
      description_ja: ' 日本語の説明 ' 
    }), {
      params: Promise.resolve({ id: 'tokyo' }),
    })

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)

    expect(mocks.prisma.city.update).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.city.update.mock.calls[0]?.[0]
    expect(call.data.description_ja).toBe('日本語の説明')
  })

  it('accepts transportTips_ja field', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.city.findUnique.mockResolvedValue({ id: 'tokyo', slug: 'tokyo' })
    mocks.prisma.city.update.mockResolvedValue({ 
      id: 'tokyo', 
      slug: 'tokyo',
      transportTips_ja: '日本語の交通情報',
      aliases: []
    })

    const handlers = await import('app/api/admin/city/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/city/tokyo', 'PATCH', { 
      transportTips_ja: ' 日本語の交通情報 ' 
    }), {
      params: Promise.resolve({ id: 'tokyo' }),
    })

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)

    expect(mocks.prisma.city.update).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.city.update.mock.calls[0]?.[0]
    expect(call.data.transportTips_ja).toBe('日本語の交通情報')
  })

  it('accepts both japanese fields at once', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.city.findUnique.mockResolvedValue({ id: 'tokyo', slug: 'tokyo' })
    mocks.prisma.city.update.mockResolvedValue({ 
      id: 'tokyo', 
      slug: 'tokyo',
      description_ja: '日本語の説明',
      transportTips_ja: '日本語の交通情報',
      aliases: []
    })

    const handlers = await import('app/api/admin/city/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/city/tokyo', 'PATCH', { 
      description_ja: '日本語の説明',
      transportTips_ja: '日本語の交通情報'
    }), {
      params: Promise.resolve({ id: 'tokyo' }),
    })

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)

    expect(mocks.prisma.city.update).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.city.update.mock.calls[0]?.[0]
    expect(call.data.description_ja).toBe('日本語の説明')
    expect(call.data.transportTips_ja).toBe('日本語の交通情報')
  })

  it('clears description_ja when null', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.city.findUnique.mockResolvedValue({ id: 'tokyo', slug: 'tokyo' })
    mocks.prisma.city.update.mockResolvedValue({ 
      id: 'tokyo', 
      slug: 'tokyo',
      description_ja: null,
      aliases: []
    })

    const handlers = await import('app/api/admin/city/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/city/tokyo', 'PATCH', { 
      description_ja: null 
    }), {
      params: Promise.resolve({ id: 'tokyo' }),
    })

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)

    expect(mocks.prisma.city.update).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.city.update.mock.calls[0]?.[0]
    expect(call.data.description_ja).toBe(null)
  })

  it('clears transportTips_ja when null', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.city.findUnique.mockResolvedValue({ id: 'tokyo', slug: 'tokyo' })
    mocks.prisma.city.update.mockResolvedValue({ 
      id: 'tokyo', 
      slug: 'tokyo',
      transportTips_ja: null,
      aliases: []
    })

    const handlers = await import('app/api/admin/city/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/city/tokyo', 'PATCH', { 
      transportTips_ja: null 
    }), {
      params: Promise.resolve({ id: 'tokyo' }),
    })

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)

    expect(mocks.prisma.city.update).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.city.update.mock.calls[0]?.[0]
    expect(call.data.transportTips_ja).toBe(null)
  })

  it('forbids non-admin', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

    const handlers = await import('app/api/admin/city/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/city/tokyo', 'PATCH', { 
      description_ja: 'test' 
    }), {
      params: Promise.resolve({ id: 'tokyo' }),
    })

    expect(res.status).toBe(403)
    expect(mocks.prisma.city.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.city.update).not.toHaveBeenCalled()
  })
})
