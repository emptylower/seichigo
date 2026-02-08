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
      upsert: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

function postReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/translations/batch', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('scans only zh source articles and creates task when no published translation exists', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.article.findMany.mockImplementation((opts: any) => {
      if (opts?.where?.status === 'published' && opts?.where?.language === 'zh') {
        return Promise.resolve([{ id: 'a1', translationGroupId: null }])
      }

      if (opts?.where?.language?.in && opts?.where?.translationGroupId?.in) {
        // Simulate only non-published translation rows exist.
        // Route should query published rows only, so this should evaluate to no translation.
        if (opts?.where?.status === 'published') return Promise.resolve([])
        return Promise.resolve([{ language: 'en', translationGroupId: 'a1' }])
      }

      return Promise.resolve([])
    })

    mocks.prisma.translationTask.findMany.mockResolvedValue([])
    mocks.prisma.translationTask.upsert.mockResolvedValue({ id: 't1' })

    const handlers = await import('app/api/admin/translations/batch/route')
    const res = await handlers.POST(
      postReq('http://localhost/api/admin/translations/batch', {
        entityType: 'article',
        targetLanguages: ['en'],
      })
    )

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({ ok: true, created: 1, skipped: 0 })

    expect(mocks.prisma.translationTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entityType_entityId_targetLanguage: {
            entityType: 'article',
            entityId: 'a1',
            targetLanguage: 'en',
          },
        },
      })
    )
  })

  it('skips creation when published translation already exists for target language', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.article.findMany.mockImplementation((opts: any) => {
      if (opts?.where?.status === 'published' && opts?.where?.language === 'zh') {
        return Promise.resolve([{ id: 'a1', translationGroupId: null }])
      }

      if (opts?.where?.language?.in && opts?.where?.translationGroupId?.in) {
        if (opts?.where?.status === 'published') {
          return Promise.resolve([{ language: 'en', translationGroupId: 'a1' }])
        }
        return Promise.resolve([])
      }

      return Promise.resolve([])
    })

    mocks.prisma.translationTask.findMany.mockResolvedValue([])
    mocks.prisma.translationTask.upsert.mockResolvedValue({ id: 't1' })

    const handlers = await import('app/api/admin/translations/batch/route')
    const res = await handlers.POST(
      postReq('http://localhost/api/admin/translations/batch', {
        entityType: 'article',
        targetLanguages: ['en'],
      })
    )

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({ ok: true, created: 0, skipped: 1 })
    expect(mocks.prisma.translationTask.upsert).not.toHaveBeenCalled()
  })
})
