import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  enqueueMapTranslationTasksForBackfill: vi.fn(),
  prisma: {},
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/translation/mapTaskEnqueue', () => ({
  enqueueMapTranslationTasksForBackfill: (...args: any[]) => mocks.enqueueMapTranslationTasksForBackfill(...args),
}))

function postReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/translations/backfill', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when unauthorized', async () => {
    mocks.getSession.mockResolvedValue(null)

    const handlers = await import('app/api/admin/translations/backfill/route')
    const res = await handlers.POST(
      postReq('http://localhost/api/admin/translations/backfill', {
        entityType: 'anitabi_bangumi',
      })
    )

    expect(res.status).toBe(401)
  })

  it('runs backfill and returns counters', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
    mocks.enqueueMapTranslationTasksForBackfill.mockResolvedValue({
      scanned: 1000,
      enqueued: 320,
      updated: 42,
      nextCursor: '1000',
      done: false,
    })

    const handlers = await import('app/api/admin/translations/backfill/route')
    const res = await handlers.POST(
      postReq('http://localhost/api/admin/translations/backfill', {
        entityType: 'anitabi_bangumi',
        targetLanguages: ['en', 'ja'],
        mode: 'all',
        limit: 1000,
        cursor: '0',
      })
    )

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({
      ok: true,
      scanned: 1000,
      enqueued: 320,
      updated: 42,
      nextCursor: '1000',
      done: false,
    })

    expect(mocks.enqueueMapTranslationTasksForBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'anitabi_bangumi',
        targetLanguages: ['en', 'ja'],
        mode: 'all',
        limit: 1000,
        cursor: '0',
      })
    )
  })
})
