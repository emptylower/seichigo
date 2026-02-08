import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    article: {
      findMany: vi.fn(),
    },
    city: {
      findMany: vi.fn(),
    },
    anime: {
      findMany: vi.fn(),
    },
    translationTask: {
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

function getReq(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' })
}

describe('GET /api/admin/translations/untranslated', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns untranslated items across article/city/anime with missingLanguages', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.article.findMany.mockImplementation((opts: any) => {
      if (opts?.where?.status === 'published' && opts?.where?.language === 'zh') {
        return Promise.resolve([
          {
            id: 'a1',
            title: 'Zh Article',
            translationGroupId: null,
            publishedAt: new Date('2024-01-10T00:00:00.000Z'),
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          },
        ])
      }

      if (opts?.where?.language?.in && opts?.where?.translationGroupId?.in) {
        return Promise.resolve([])
      }

      return Promise.resolve([])
    })

    mocks.prisma.city.findMany.mockResolvedValue([
      {
        id: 'c1',
        name_zh: 'Tokyo',
        name_en: null,
        name_ja: null,
        description_en: null,
        transportTips_en: null,
        description_ja: null,
        transportTips_ja: null,
        createdAt: new Date('2024-02-01T00:00:00.000Z'),
      },
    ])

    mocks.prisma.anime.findMany.mockResolvedValue([
      {
        id: 'an1',
        name: 'Anime One',
        name_en: 'Anime One EN',
        name_ja: null,
        summary_en: null,
        summary_ja: null,
        createdAt: new Date('2024-03-01T00:00:00.000Z'),
      },
    ])

    mocks.prisma.translationTask.findMany.mockResolvedValue([])

    const handlers = await import('app/api/admin/translations/untranslated/route')
    const res = await handlers.GET(getReq('http://localhost/api/admin/translations/untranslated'))

    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j.total).toBe(3)
    expect(j.items).toHaveLength(3)

    const byKey = new Map<string, any>(j.items.map((it: any) => [`${it.entityType}:${it.entityId}`, it] as const))

    expect(byKey.get('article:a1')).toMatchObject({
      entityType: 'article',
      entityId: 'a1',
      title: 'Zh Article',
      missingLanguages: ['en', 'ja'],
    })

    expect(byKey.get('city:c1')).toMatchObject({
      entityType: 'city',
      entityId: 'c1',
      title: 'Tokyo',
      missingLanguages: ['en', 'ja'],
    })

    expect(byKey.get('anime:an1')).toMatchObject({
      entityType: 'anime',
      entityId: 'an1',
      title: 'Anime One',
      missingLanguages: ['ja'],
    })

    expect(new Date(byKey.get('article:a1').date).toISOString()).toBe('2024-01-10T00:00:00.000Z')
    expect(new Date(byKey.get('city:c1').date).toISOString()).toBe('2024-02-01T00:00:00.000Z')
    expect(new Date(byKey.get('anime:an1').date).toISOString()).toBe('2024-03-01T00:00:00.000Z')

    // Ensure route queries published-only articles and filters hidden entities in DB query.
    expect(mocks.prisma.article.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'published',
          language: 'zh',
        }),
      })
    )
    expect(mocks.prisma.city.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ hidden: false }) })
    )
    expect(mocks.prisma.anime.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ hidden: false }) })
    )
  })

  it('filters out entities that already have TranslationTask', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.article.findMany.mockImplementation((opts: any) => {
      if (opts?.where?.status === 'published' && opts?.where?.language === 'zh') {
        return Promise.resolve([
          {
            id: 'a1',
            title: 'Zh Article',
            translationGroupId: null,
            publishedAt: new Date('2024-01-10T00:00:00.000Z'),
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          },
        ])
      }
      if (opts?.where?.language?.in && opts?.where?.translationGroupId?.in) {
        return Promise.resolve([])
      }
      return Promise.resolve([])
    })

    mocks.prisma.city.findMany.mockResolvedValue([
      {
        id: 'c1',
        name_zh: 'Tokyo',
        name_en: null,
        name_ja: null,
        description_en: null,
        transportTips_en: null,
        description_ja: null,
        transportTips_ja: null,
        createdAt: new Date('2024-02-01T00:00:00.000Z'),
      },
    ])

    mocks.prisma.anime.findMany.mockResolvedValue([
      {
        id: 'an1',
        name: 'Anime One',
        name_en: null,
        name_ja: null,
        summary_en: null,
        summary_ja: null,
        createdAt: new Date('2024-03-01T00:00:00.000Z'),
      },
    ])

    mocks.prisma.translationTask.findMany.mockImplementation((opts: any) => {
      if (opts?.where?.entityType === 'article') return Promise.resolve([{ entityId: 'a1', targetLanguage: 'en' }])
      if (opts?.where?.entityType === 'city') return Promise.resolve([{ entityId: 'c1', targetLanguage: 'ja' }])
      if (opts?.where?.entityType === 'anime') return Promise.resolve([{ entityId: 'an1', targetLanguage: 'en' }])
      return Promise.resolve([])
    })

    const handlers = await import('app/api/admin/translations/untranslated/route')
    const res = await handlers.GET(getReq('http://localhost/api/admin/translations/untranslated'))

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.total).toBe(0)
    expect(j.items).toEqual([])
  })

  it('computes missingLanguages correctly for article translation groups', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.article.findMany.mockImplementation((opts: any) => {
      if (opts?.where?.status === 'published' && opts?.where?.language === 'zh') {
        return Promise.resolve([
          {
            id: 'a1',
            title: 'Zh Article',
            translationGroupId: null,
            publishedAt: new Date('2024-01-10T00:00:00.000Z'),
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          },
        ])
      }

      if (opts?.where?.language?.in && opts?.where?.translationGroupId?.in && opts?.where?.status === 'published') {
        return Promise.resolve([{ language: 'en', translationGroupId: 'a1' }])
      }

      return Promise.resolve([])
    })

    mocks.prisma.city.findMany.mockResolvedValue([])
    mocks.prisma.anime.findMany.mockResolvedValue([])
    mocks.prisma.translationTask.findMany.mockResolvedValue([])

    const handlers = await import('app/api/admin/translations/untranslated/route')
    const res = await handlers.GET(getReq('http://localhost/api/admin/translations/untranslated'))

    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j.total).toBe(1)
    expect(j.items[0]).toMatchObject({
      entityType: 'article',
      entityId: 'a1',
      missingLanguages: ['ja'],
    })
  })

  it('ignores draft translations when computing article missing languages', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.article.findMany.mockImplementation((opts: any) => {
      if (opts?.where?.status === 'published' && opts?.where?.language === 'zh') {
        return Promise.resolve([
          {
            id: 'a1',
            title: 'Zh Article',
            translationGroupId: null,
            publishedAt: new Date('2024-01-10T00:00:00.000Z'),
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          },
        ])
      }

      if (opts?.where?.language?.in && opts?.where?.translationGroupId?.in) {
        // Simulate there is only a non-published translation.
        // Route should query published rows only, so this branch should return empty.
        if (opts?.where?.status === 'published') return Promise.resolve([])
        return Promise.resolve([{ language: 'en', translationGroupId: 'a1' }])
      }

      return Promise.resolve([])
    })

    mocks.prisma.city.findMany.mockResolvedValue([])
    mocks.prisma.anime.findMany.mockResolvedValue([])
    mocks.prisma.translationTask.findMany.mockResolvedValue([])

    const handlers = await import('app/api/admin/translations/untranslated/route')
    const res = await handlers.GET(getReq('http://localhost/api/admin/translations/untranslated'))

    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j.total).toBe(1)
    expect(j.items[0]).toMatchObject({
      entityType: 'article',
      entityId: 'a1',
      missingLanguages: ['en', 'ja'],
    })
  })

  it('city with only name_ja (missing description_ja and transportTips_ja) should have missingLanguages: ["ja"]', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.article.findMany.mockImplementation(() => Promise.resolve([]))
    mocks.prisma.anime.findMany.mockResolvedValue([])
    mocks.prisma.translationTask.findMany.mockResolvedValue([])

    mocks.prisma.city.findMany.mockResolvedValue([
      {
        id: 'c1',
        name_zh: 'Tokyo',
        name_en: 'Tokyo EN',
        name_ja: 'Tokyo JA',
        description_en: 'Description EN',
        transportTips_en: 'Tips EN',
        description_ja: null,
        transportTips_ja: null,
        createdAt: new Date('2024-02-01T00:00:00.000Z'),
      },
    ])

    const handlers = await import('app/api/admin/translations/untranslated/route')
    const res = await handlers.GET(getReq('http://localhost/api/admin/translations/untranslated'))

    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j.total).toBe(1)
    expect(j.items[0]).toMatchObject({
      entityType: 'city',
      entityId: 'c1',
      title: 'Tokyo',
      missingLanguages: ['ja'],
    })
  })

  it('city with all 3 JA fields should NOT appear in untranslated list', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.article.findMany.mockImplementation(() => Promise.resolve([]))
    mocks.prisma.anime.findMany.mockResolvedValue([])
    mocks.prisma.translationTask.findMany.mockResolvedValue([])

    mocks.prisma.city.findMany.mockResolvedValue([
      {
        id: 'c1',
        name_zh: 'Tokyo',
        name_en: 'Tokyo EN',
        name_ja: 'Tokyo JA',
        description_en: 'Description EN',
        transportTips_en: 'Tips EN',
        description_ja: 'Description JA',
        transportTips_ja: 'Tips JA',
        createdAt: new Date('2024-02-01T00:00:00.000Z'),
      },
    ])

    const handlers = await import('app/api/admin/translations/untranslated/route')
    const res = await handlers.GET(getReq('http://localhost/api/admin/translations/untranslated'))

    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j.total).toBe(0)
    expect(j.items).toEqual([])
  })

  it('empty string should be treated as missing (name_ja: "" = untranslated)', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.article.findMany.mockImplementation(() => Promise.resolve([]))
    mocks.prisma.anime.findMany.mockResolvedValue([])
    mocks.prisma.translationTask.findMany.mockResolvedValue([])

    mocks.prisma.city.findMany.mockResolvedValue([
      {
        id: 'c1',
        name_zh: 'Tokyo',
        name_en: 'Tokyo EN',
        name_ja: '',
        description_en: 'Description EN',
        transportTips_en: 'Tips EN',
        description_ja: 'Description JA',
        transportTips_ja: 'Tips JA',
        createdAt: new Date('2024-02-01T00:00:00.000Z'),
      },
    ])

    const handlers = await import('app/api/admin/translations/untranslated/route')
    const res = await handlers.GET(getReq('http://localhost/api/admin/translations/untranslated'))

    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j.total).toBe(1)
    expect(j.items[0]).toMatchObject({
      entityType: 'city',
      entityId: 'c1',
      title: 'Tokyo',
      missingLanguages: ['ja'],
    })
  })

  it('whitespace-only strings should be treated as missing', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.article.findMany.mockImplementation(() => Promise.resolve([]))
    mocks.prisma.anime.findMany.mockResolvedValue([])
    mocks.prisma.translationTask.findMany.mockResolvedValue([])

    mocks.prisma.city.findMany.mockResolvedValue([
      {
        id: 'c1',
        name_zh: 'Tokyo',
        name_en: 'Tokyo EN',
        name_ja: '   ',
        description_en: 'Description EN',
        transportTips_en: 'Tips EN',
        description_ja: '\t\n',
        transportTips_ja: 'Tips JA',
        createdAt: new Date('2024-02-01T00:00:00.000Z'),
      },
    ])

    const handlers = await import('app/api/admin/translations/untranslated/route')
    const res = await handlers.GET(getReq('http://localhost/api/admin/translations/untranslated'))

    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j.total).toBe(1)
    expect(j.items[0]).toMatchObject({
      entityType: 'city',
      entityId: 'c1',
      title: 'Tokyo',
      missingLanguages: ['ja'],
    })
  })
})
