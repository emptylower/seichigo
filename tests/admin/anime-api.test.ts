import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAnimeById: vi.fn(),
  prisma: {
    anime: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    article: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    articleRevision: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
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
    mocks.prisma.$transaction.mockImplementation(async (cb: any) => cb(mocks.prisma))
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

  it('accepts name_en translation field', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.getAnimeById.mockResolvedValue({ id: 'btr', name: 'Original', cover: null, summary: null, hidden: false })
    mocks.prisma.anime.upsert.mockResolvedValue({ id: 'btr', name: 'Original', name_en: 'English Name', cover: null, summary: null, hidden: false })

    const handlers = await import('app/api/admin/anime/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/anime/btr', 'PATCH', { name_en: ' English Name ' }), {
      params: Promise.resolve({ id: 'btr' }),
    })

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)

    expect(mocks.prisma.anime.upsert).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.anime.upsert.mock.calls[0]?.[0]
    expect(call.update.name_en).toBe('English Name')
  })

  it('accepts name_ja translation field', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.getAnimeById.mockResolvedValue({ id: 'btr', name: 'Original', cover: null, summary: null, hidden: false })
    mocks.prisma.anime.upsert.mockResolvedValue({ id: 'btr', name: 'Original', name_ja: '日本語名', cover: null, summary: null, hidden: false })

    const handlers = await import('app/api/admin/anime/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/anime/btr', 'PATCH', { name_ja: ' 日本語名 ' }), {
      params: Promise.resolve({ id: 'btr' }),
    })

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)

    expect(mocks.prisma.anime.upsert).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.anime.upsert.mock.calls[0]?.[0]
    expect(call.update.name_ja).toBe('日本語名')
  })

  it('accepts summary_en translation field', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.getAnimeById.mockResolvedValue({ id: 'btr', name: 'Original', cover: null, summary: null, hidden: false })
    mocks.prisma.anime.upsert.mockResolvedValue({ id: 'btr', name: 'Original', summary_en: 'English summary', cover: null, summary: null, hidden: false })

    const handlers = await import('app/api/admin/anime/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/anime/btr', 'PATCH', { summary_en: ' English summary ' }), {
      params: Promise.resolve({ id: 'btr' }),
    })

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)

    expect(mocks.prisma.anime.upsert).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.anime.upsert.mock.calls[0]?.[0]
    expect(call.update.summary_en).toBe('English summary')
  })

  it('accepts summary_ja translation field', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.getAnimeById.mockResolvedValue({ id: 'btr', name: 'Original', cover: null, summary: null, hidden: false })
    mocks.prisma.anime.upsert.mockResolvedValue({ id: 'btr', name: 'Original', summary_ja: '日本語の概要', cover: null, summary: null, hidden: false })

    const handlers = await import('app/api/admin/anime/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/anime/btr', 'PATCH', { summary_ja: ' 日本語の概要 ' }), {
      params: Promise.resolve({ id: 'btr' }),
    })

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)

    expect(mocks.prisma.anime.upsert).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.anime.upsert.mock.calls[0]?.[0]
    expect(call.update.summary_ja).toBe('日本語の概要')
  })

  it('accepts multiple translation fields at once', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.getAnimeById.mockResolvedValue({ id: 'btr', name: 'Original', cover: null, summary: null, hidden: false })
    mocks.prisma.anime.upsert.mockResolvedValue({ 
      id: 'btr', 
      name: 'Original', 
      name_en: 'English Name',
      name_ja: '日本語名',
      summary_en: 'English summary',
      summary_ja: '日本語の概要',
      cover: null, 
      summary: null, 
      hidden: false 
    })

    const handlers = await import('app/api/admin/anime/[id]/route')
    const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/anime/btr', 'PATCH', { 
      name_en: 'English Name',
      name_ja: '日本語名',
      summary_en: 'English summary',
      summary_ja: '日本語の概要'
    }), {
      params: Promise.resolve({ id: 'btr' }),
    })

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)

    expect(mocks.prisma.anime.upsert).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.anime.upsert.mock.calls[0]?.[0]
    expect(call.update.name_en).toBe('English Name')
    expect(call.update.name_ja).toBe('日本語名')
    expect(call.update.summary_en).toBe('English summary')
    expect(call.update.summary_ja).toBe('日本語の概要')
  })

  it('renames anime id when there are no article references', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.getAnimeById.mockResolvedValue({ id: '天气之子', name: '天气之子', cover: null, summary: null, hidden: false })
    mocks.prisma.anime.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === '天气之子') {
        return {
          id: '天气之子',
          name: '天气之子',
          alias: [],
          year: null,
          summary: null,
          cover: null,
          hidden: false,
          name_en: null,
          name_ja: null,
          summary_en: null,
          summary_ja: null,
        }
      }
      if (where.id === 'weathering-with-you') return null
      return null
    })
    mocks.prisma.article.findMany.mockResolvedValue([])
    mocks.prisma.articleRevision.findMany.mockResolvedValue([])
    mocks.prisma.anime.create.mockResolvedValue({
      id: 'weathering-with-you',
      name: '天气之子',
      alias: [],
      year: null,
      summary: null,
      cover: null,
      hidden: false,
      name_en: null,
      name_ja: null,
      summary_en: null,
      summary_ja: null,
    })
    mocks.prisma.anime.delete.mockResolvedValue({ id: '天气之子' })

    const handlers = await import('app/api/admin/anime/[id]/route')
    const res = await handlers.PATCH(
      jsonReq('http://localhost/api/admin/anime/weathering-with-you', 'PATCH', { nextId: 'weathering-with-you' }),
      {
        params: Promise.resolve({ id: '天气之子' }),
      }
    )

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.anime.id).toBe('weathering-with-you')
    expect(mocks.prisma.anime.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: 'weathering-with-you' }) }))
    expect(mocks.prisma.anime.delete).toHaveBeenCalledWith({ where: { id: '天气之子' } })
    expect(mocks.prisma.anime.upsert).not.toHaveBeenCalled()
  })

  it('merges file-source old id into existing target id and migrates article references', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.getAnimeById.mockResolvedValue({ id: '天气之子', name: '天气之子', cover: null, summary: null, hidden: false })
    mocks.prisma.anime.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === '天气之子') return null
      if (where.id === 'weathering-with-you') {
        return {
          id: 'weathering-with-you',
          name: '天气之子',
          alias: ['天気の子'],
          year: null,
          summary: null,
          cover: null,
          hidden: true,
          name_en: null,
          name_ja: null,
          summary_en: null,
          summary_ja: null,
        }
      }
      return null
    })
    mocks.prisma.anime.update.mockResolvedValue({
      id: 'weathering-with-you',
      name: '天气之子',
      alias: ['天気の子', 'weathering-with-you', '天气之子'],
      hidden: false,
    })
    mocks.prisma.article.findMany.mockResolvedValue([
      { id: 'a1', animeIds: ['天气之子'] },
      { id: 'a2', animeIds: ['foo', '天气之子'] },
    ])
    mocks.prisma.article.update.mockResolvedValue(null)
    mocks.prisma.articleRevision.findMany.mockResolvedValue([{ id: 'r1', animeIds: ['天气之子'] }])
    mocks.prisma.articleRevision.update.mockResolvedValue(null)
    mocks.prisma.anime.upsert.mockResolvedValue({
      id: '天气之子',
      name: '天气之子',
      hidden: true,
      alias: ['weathering-with-you'],
    })

    const handlers = await import('app/api/admin/anime/[id]/route')
    const res = await handlers.PATCH(
      jsonReq('http://localhost/api/admin/anime/weathering-with-you', 'PATCH', { nextId: 'weathering-with-you' }),
      {
        params: Promise.resolve({ id: '天气之子' }),
      }
    )

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.anime.id).toBe('weathering-with-you')
    expect(mocks.prisma.anime.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'weathering-with-you' },
        data: expect.objectContaining({ hidden: false }),
      })
    )
    expect(mocks.prisma.article.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { animeIds: ['weathering-with-you'] },
    })
    expect(mocks.prisma.articleRevision.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { animeIds: ['weathering-with-you'] },
    })
    expect(mocks.prisma.anime.create).not.toHaveBeenCalled()
    expect(mocks.prisma.anime.delete).not.toHaveBeenCalled()
    expect(mocks.prisma.anime.upsert).not.toHaveBeenCalled()
  })

  it('inherits metadata from db source when merging into existing target id', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.getAnimeById.mockResolvedValue({
      id: 'bocchi-the-roc',
      name: '孤独摇滚!',
      cover: 'https://cdn.example.com/custom-cover.jpg',
      summary: 'custom summary',
      hidden: false,
    })
    mocks.prisma.anime.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'bocchi-the-roc') {
        return {
          id: 'bocchi-the-roc',
          name: '孤独摇滚!',
          alias: [],
          year: 2022,
          summary: 'custom summary',
          cover: 'https://cdn.example.com/custom-cover.jpg',
          hidden: false,
          name_en: 'Bocchi the Rock!',
          name_ja: 'ぼっち・ざ・ろっく！',
          summary_en: 'custom summary en',
          summary_ja: 'custom summary ja',
        }
      }
      if (where.id === 'bocchi-the-rock') {
        return {
          id: 'bocchi-the-rock',
          name: 'Bocchi the Rock!',
          alias: ['btr'],
          year: null,
          summary: null,
          cover: null,
          hidden: false,
          name_en: null,
          name_ja: null,
          summary_en: null,
          summary_ja: null,
        }
      }
      return null
    })
    mocks.prisma.anime.update.mockResolvedValue({
      id: 'bocchi-the-rock',
      name: '孤独摇滚!',
      alias: ['btr', 'bocchi-the-roc'],
      year: 2022,
      summary: 'custom summary',
      cover: 'https://cdn.example.com/custom-cover.jpg',
      hidden: false,
    })
    mocks.prisma.article.findMany.mockResolvedValue([])
    mocks.prisma.articleRevision.findMany.mockResolvedValue([])
    mocks.prisma.anime.delete.mockResolvedValue({ id: 'bocchi-the-roc' })

    const handlers = await import('app/api/admin/anime/[id]/route')
    const res = await handlers.PATCH(
      jsonReq('http://localhost/api/admin/anime/bocchi-the-roc', 'PATCH', { nextId: 'bocchi-the-rock' }),
      {
        params: Promise.resolve({ id: 'bocchi-the-roc' }),
      }
    )

    expect(res.status).toBe(200)
    expect(mocks.prisma.anime.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bocchi-the-rock' },
        data: expect.objectContaining({
          name: '孤独摇滚!',
          cover: 'https://cdn.example.com/custom-cover.jpg',
          summary: 'custom summary',
          year: 2022,
          name_en: 'Bocchi the Rock!',
          name_ja: 'ぼっち・ざ・ろっく！',
          summary_en: 'custom summary en',
          summary_ja: 'custom summary ja',
        }),
      })
    )
  })
})
