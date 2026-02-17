import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    translationTask: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
  executeMapTranslationTasks: vi.fn(),
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

vi.mock('@/lib/translation/mapTaskExecutor', () => ({
  executeMapTranslationTasks: (...args: any[]) => mocks.executeMapTranslationTasks(...args),
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

    mocks.prisma.translationTask.findMany.mockImplementation((opts: any) => {
      if (opts?.where?.id?.in && !opts?.where?.status) {
        return Promise.resolve([
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
      }

      if (opts?.where?.id?.in && opts?.where?.status === 'processing') {
        return Promise.resolve([
          {
            id: 't1',
            entityType: 'article',
            entityId: 'a1',
            targetLanguage: 'en',
            status: 'processing',
          },
          {
            id: 't3',
            entityType: 'anime',
            entityId: 'an1',
            targetLanguage: 'ja',
            status: 'processing',
          },
        ])
      }

      return Promise.resolve([])
    })

    mocks.prisma.translationTask.updateMany.mockResolvedValue({ count: 2 })
    mocks.prisma.translationTask.update.mockResolvedValue({})
    mocks.executeMapTranslationTasks.mockResolvedValue([])
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

    expect(mocks.prisma.translationTask.updateMany).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.translationTask.update).toHaveBeenCalledTimes(2)
  })

  it('supports filter mode and delegates map tasks to map executor', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.prisma.translationTask.findMany.mockImplementation((opts: any) => {
      if (opts?.where?.status?.in && opts?.select?.id && !opts?.where?.id) {
        return Promise.resolve([{ id: 'm1' }])
      }

      if (opts?.where?.id?.in && !opts?.where?.status) {
        return Promise.resolve([
          {
            id: 'm1',
            entityType: 'anitabi_point',
            entityId: 'p1',
            targetLanguage: 'en',
            status: 'pending',
          },
        ])
      }

      if (opts?.where?.id?.in && opts?.where?.status === 'processing') {
        return Promise.resolve([
          {
            id: 'm1',
            entityType: 'anitabi_point',
            entityId: 'p1',
            targetLanguage: 'en',
            status: 'processing',
          },
        ])
      }

      return Promise.resolve([])
    })

    mocks.prisma.translationTask.updateMany.mockResolvedValue({ count: 1 })
    mocks.executeMapTranslationTasks.mockResolvedValue([
      { taskId: 'm1', status: 'ready' },
    ])

    const handlers = await import('app/api/admin/translations/execute/route')
    const res = await handlers.POST(
      postReq('http://localhost/api/admin/translations/execute', {
        entityType: 'anitabi_point',
        targetLanguage: 'en',
        limit: 100,
      })
    )

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({
      ok: true,
      total: 1,
      processed: 1,
      success: 1,
      failed: 0,
      skipped: 0,
    })
    expect(mocks.executeMapTranslationTasks).toHaveBeenCalledTimes(1)
    expect(mocks.translateArticle).not.toHaveBeenCalled()
  })
})
