import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    translationTask: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
  translateArticle: vi.fn(),
  translateCity: vi.fn(),
  translateAnime: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/translation/service', () => ({
  translateArticle: (...args: any[]) => mocks.translateArticle(...args),
  translateCity: (...args: any[]) => mocks.translateCity(...args),
  translateAnime: (...args: any[]) => mocks.translateAnime(...args),
}))

function postReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/translations/execute', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mocks.getSession.mockResolvedValue(null)

    const handlers = await import('app/api/admin/translations/execute/route')
    const res = await handlers.POST(
      postReq('http://localhost/api/admin/translations/execute', { taskIds: ['t1'] })
    )

    expect(res.status).toBe(401)
  })

  it('executes pending/failed tasks and skips invalid statuses', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.translationTask.findMany.mockResolvedValue([
      {
        id: 't1',
        entityType: 'article',
        entityId: 'a1',
        targetLanguage: 'en',
        status: 'pending',
      },
      {
        id: 't2',
        entityType: 'city',
        entityId: 'c1',
        targetLanguage: 'ja',
        status: 'approved',
      },
      {
        id: 't3',
        entityType: 'anime',
        entityId: 'an1',
        targetLanguage: 'ja',
        status: 'failed',
      },
    ])

    mocks.prisma.translationTask.update.mockResolvedValue({})
    mocks.translateArticle.mockResolvedValue({
      success: true,
      sourceContent: { title: 'source' },
      translatedContent: { title: 'translated' },
    })
    mocks.translateAnime.mockResolvedValue({
      success: false,
      error: 'provider error',
    })

    const handlers = await import('app/api/admin/translations/execute/route')
    const res = await handlers.POST(
      postReq('http://localhost/api/admin/translations/execute', {
        taskIds: ['t1', 't2', 't3', 'missing'],
      })
    )

    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j).toMatchObject({
      ok: true,
      total: 4,
      processed: 2,
      success: 1,
      failed: 1,
      skipped: 2,
    })
    expect(mocks.translateArticle).toHaveBeenCalledWith('a1', 'en')
    expect(mocks.translateAnime).toHaveBeenCalledWith('an1', 'ja')
    expect(mocks.translateCity).not.toHaveBeenCalled()

    // t1: processing + ready, t3: processing + failed
    expect(mocks.prisma.translationTask.update).toHaveBeenCalledTimes(4)
  })
})
