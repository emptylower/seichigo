import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAnimeById: vi.fn(),
  getCityById: vi.fn(),
  prisma: {
    anime: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    city: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  translateText: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/anime/getAllAnime', () => ({
  getAnimeById: (...args: any[]) => mocks.getAnimeById(...args),
}))

vi.mock('@/lib/city/getAllCities', () => ({
  getCityById: (...args: any[]) => mocks.getCityById(...args),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/translation/gemini', () => ({
  translateText: (...args: any[]) => mocks.translateText(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

function jsonReq(url: string, method: string, body?: any): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('admin translation integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('anime translation editing', () => {
    it('allows admin to edit anime translations (name_en, name_ja, summary_en, summary_ja)', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.getAnimeById.mockResolvedValue({ 
        id: 'btr', 
        name: 'Original Name', 
        cover: null, 
        summary: 'Original Summary', 
        hidden: false 
      })
      mocks.prisma.anime.upsert.mockResolvedValue({ 
        id: 'btr', 
        name: 'Original Name',
        name_en: 'English Name',
        name_ja: '日本語名',
        summary: 'Original Summary',
        summary_en: 'English Summary',
        summary_ja: '日本語の概要',
        cover: null, 
        hidden: false 
      })

      const handlers = await import('app/api/admin/anime/[id]/route')
      const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/anime/btr', 'PATCH', { 
        name_en: 'English Name',
        name_ja: '日本語名',
        summary_en: 'English Summary',
        summary_ja: '日本語の概要'
      }), {
        params: Promise.resolve({ id: 'btr' }),
      })

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.ok).toBe(true)
      expect(j.anime.name_en).toBe('English Name')
      expect(j.anime.name_ja).toBe('日本語名')
      expect(j.anime.summary_en).toBe('English Summary')
      expect(j.anime.summary_ja).toBe('日本語の概要')

      expect(mocks.prisma.anime.upsert).toHaveBeenCalledTimes(1)
      const call = mocks.prisma.anime.upsert.mock.calls[0]?.[0]
      expect(call.update.name_en).toBe('English Name')
      expect(call.update.name_ja).toBe('日本語名')
      expect(call.update.summary_en).toBe('English Summary')
      expect(call.update.summary_ja).toBe('日本語の概要')
    })

    it('trims whitespace from translation fields', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.getAnimeById.mockResolvedValue({ 
        id: 'btr', 
        name: 'Original', 
        cover: null, 
        summary: null, 
        hidden: false 
      })
      mocks.prisma.anime.upsert.mockResolvedValue({ 
        id: 'btr', 
        name: 'Original',
        name_en: 'Trimmed Name',
        summary_en: 'Trimmed Summary',
        cover: null, 
        summary: null, 
        hidden: false 
      })

      const handlers = await import('app/api/admin/anime/[id]/route')
      const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/anime/btr', 'PATCH', { 
        name_en: '  Trimmed Name  ',
        summary_en: '  Trimmed Summary  '
      }), {
        params: Promise.resolve({ id: 'btr' }),
      })

      expect(res.status).toBe(200)
      const call = mocks.prisma.anime.upsert.mock.calls[0]?.[0]
      expect(call.update.name_en).toBe('Trimmed Name')
      expect(call.update.summary_en).toBe('Trimmed Summary')
    })
  })

  describe('city translation editing', () => {
    it('allows admin to edit city Japanese translations (description_ja, transportTips_ja)', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.city.findUnique.mockResolvedValue({ 
        id: 'tokyo',
        slug: 'tokyo',
        name_zh: 'Tokyo',
        description_zh: 'Original Description',
        transportTips_zh: 'Original Tips',
        hidden: false 
      })
      mocks.prisma.city.update.mockResolvedValue({ 
        id: 'tokyo',
        slug: 'tokyo',
        name_zh: 'Tokyo',
        description_zh: 'Original Description',
        description_ja: '日本語の説明',
        transportTips_zh: 'Original Tips',
        transportTips_ja: '日本語の交通情報',
        hidden: false,
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
      expect(j.city.description_ja).toBe('日本語の説明')
      expect(j.city.transportTips_ja).toBe('日本語の交通情報')

      expect(mocks.prisma.city.update).toHaveBeenCalledTimes(1)
      const call = mocks.prisma.city.update.mock.calls[0]?.[0]
      expect(call.data.description_ja).toBe('日本語の説明')
      expect(call.data.transportTips_ja).toBe('日本語の交通情報')
    })

    it('trims whitespace from city Japanese translation fields', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.city.findUnique.mockResolvedValue({ 
        id: 'tokyo',
        slug: 'tokyo',
        name_zh: 'Tokyo',
        description_zh: 'Original',
        transportTips_zh: 'Original',
        hidden: false 
      })
      mocks.prisma.city.update.mockResolvedValue({ 
        id: 'tokyo',
        slug: 'tokyo',
        name_zh: 'Tokyo',
        description_zh: 'Original',
        description_ja: 'Trimmed Description',
        transportTips_zh: 'Original',
        transportTips_ja: 'Trimmed Tips',
        hidden: false,
        aliases: []
      })

      const handlers = await import('app/api/admin/city/[id]/route')
      const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/city/tokyo', 'PATCH', { 
        description_ja: '  Trimmed Description  ',
        transportTips_ja: '  Trimmed Tips  '
      }), {
        params: Promise.resolve({ id: 'tokyo' }),
      })

      expect(res.status).toBe(200)
      const call = mocks.prisma.city.update.mock.calls[0]?.[0]
      expect(call.data.description_ja).toBe('Trimmed Description')
      expect(call.data.transportTips_ja).toBe('Trimmed Tips')
    })
  })

  describe('re-translate workflow', () => {
    it('generates translation preview via Gemini API', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.anime.findUnique.mockResolvedValue({
        id: 'btr',
        name: 'Original Name',
        summary: 'Original Summary',
      })
      mocks.translateText
        .mockResolvedValueOnce('Translated Name')
        .mockResolvedValueOnce('Translated Summary')

      const handlers = await import('app/api/admin/retranslate/route')
      const res = await handlers.POST(jsonReq('http://localhost/api/admin/retranslate', 'POST', {
        entityType: 'anime',
        entityId: 'btr',
        targetLang: 'en'
      }))

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.ok).toBe(true)
      expect(j.preview.name).toBe('Translated Name')
      expect(j.preview.summary).toBe('Translated Summary')
      expect(j.sourceContent.name).toBe('Original Name')

      expect(mocks.translateText).toHaveBeenCalledTimes(2)
      expect(mocks.translateText).toHaveBeenCalledWith('Original Name', 'en')
      expect(mocks.translateText).toHaveBeenCalledWith('Original Summary', 'en')
    })

    it('applies translation preview to anime', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.anime.update.mockResolvedValue({ 
        id: 'btr', 
        name: 'Applied Translation',
        summary: 'Applied Summary',
        cover: null, 
        hidden: false 
      })

      const handlers = await import('app/api/admin/retranslate/apply/route')
      const res = await handlers.POST(jsonReq('http://localhost/api/admin/retranslate/apply', 'POST', {
        entityType: 'anime',
        entityId: 'btr',
        targetLang: 'en',
        preview: {
          name: 'Applied Translation',
          summary: 'Applied Summary'
        }
      }))

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.ok).toBe(true)
      expect(j.updated.name).toBe('Applied Translation')
      expect(j.updated.summary).toBe('Applied Summary')

      expect(mocks.prisma.anime.update).toHaveBeenCalledTimes(1)
      const call = mocks.prisma.anime.update.mock.calls[0]?.[0]
      expect(call.data.name).toBe('Applied Translation')
      expect(call.data.summary).toBe('Applied Summary')
    })

    it('applies translation preview to city', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.city.update.mockResolvedValue({ 
        id: 'tokyo', 
        name_zh: 'Tokyo',
        description_zh: 'Original Description',
        description_ja: 'Applied Description',
        transportTips_zh: 'Original Tips',
        transportTips_ja: 'Applied Tips',
        hidden: false 
      })

      const handlers = await import('app/api/admin/retranslate/apply/route')
      const res = await handlers.POST(jsonReq('http://localhost/api/admin/retranslate/apply', 'POST', {
        entityType: 'city',
        entityId: 'tokyo',
        targetLang: 'ja',
        preview: {
          description: 'Applied Description',
          transportTips: 'Applied Tips'
        }
      }))

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.ok).toBe(true)
      expect(j.updated.description_ja).toBe('Applied Description')
      expect(j.updated.transportTips_ja).toBe('Applied Tips')

      expect(mocks.prisma.city.update).toHaveBeenCalledTimes(1)
      const call = mocks.prisma.city.update.mock.calls[0]?.[0]
      expect(call.data.description_ja).toBe('Applied Description')
      expect(call.data.transportTips_ja).toBe('Applied Tips')
    })

    it('rejects apply request with invalid entity type', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

      const handlers = await import('app/api/admin/retranslate/apply/route')
      const res = await handlers.POST(jsonReq('http://localhost/api/admin/retranslate/apply', 'POST', {
        entityType: 'invalid',
        entityId: 'test',
        targetLang: 'en',
        preview: { name: 'Test' }
      }))

      expect(res.status).toBe(400)
      const j = await res.json()
      expect(j.error).toBeTruthy()
    })
  })

  describe('authorization', () => {
    it('forbids non-admin from editing anime translations', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

      const handlers = await import('app/api/admin/anime/[id]/route')
      const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/anime/btr', 'PATCH', { 
        name_en: 'Hacked' 
      }), {
        params: Promise.resolve({ id: 'btr' }),
      })

      expect(res.status).toBe(403)
      expect(mocks.prisma.anime.upsert).not.toHaveBeenCalled()
    })

    it('forbids non-admin from editing city translations', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

      const handlers = await import('app/api/admin/city/[id]/route')
      const res = await handlers.PATCH(jsonReq('http://localhost/api/admin/city/tokyo', 'PATCH', { 
        description_ja: 'Hacked' 
      }), {
        params: Promise.resolve({ id: 'tokyo' }),
      })

      expect(res.status).toBe(403)
      expect(mocks.prisma.city.update).not.toHaveBeenCalled()
    })

    it('forbids non-admin from using re-translate', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

      const handlers = await import('app/api/admin/retranslate/route')
      const res = await handlers.POST(jsonReq('http://localhost/api/admin/retranslate', 'POST', {
        entityType: 'anime',
        entityId: 'btr',
        targetLang: 'en'
      }))

      expect(res.status).toBe(403)
      expect(mocks.translateText).not.toHaveBeenCalled()
    })
  })
})
