import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getTranslationApiDeps: vi.fn(),
  runMapOps: vi.fn(),
}))

vi.mock('@/lib/translation/api', () => ({
  getTranslationApiDeps: mocks.getTranslationApiDeps,
}))

vi.mock('@/lib/translation/mapOps', () => ({
  runMapOps: mocks.runMapOps,
}))

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/translations/map-ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/translations/map-ops', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when session is not admin', async () => {
    mocks.getTranslationApiDeps.mockResolvedValue({
      prisma: {},
      getSession: vi.fn().mockResolvedValue(null),
    })

    const handlers = await import('app/api/admin/translations/map-ops/route')
    const res = await handlers.POST(postReq({ action: 'execute_round' }))

    expect(res.status).toBe(401)
    expect(mocks.runMapOps).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid action payload', async () => {
    mocks.getTranslationApiDeps.mockResolvedValue({
      prisma: {},
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'admin-1', isAdmin: true },
      }),
    })

    const handlers = await import('app/api/admin/translations/map-ops/route')
    const res = await handlers.POST(postReq({ action: 'bad_action' }))

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
    expect(mocks.runMapOps).not.toHaveBeenCalled()
  })

  it('delegates validated requests to runMapOps with parsed defaults', async () => {
    const prisma = { marker: 'prisma' }
    mocks.getTranslationApiDeps.mockResolvedValue({
      prisma,
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'admin-1', isAdmin: true },
      }),
    })
    mocks.runMapOps.mockResolvedValue({
      ok: true,
      action: 'execute_round',
      done: true,
      message: '执行完成',
      bangumiBackfillCursor: null,
      pointBackfillCursor: null,
      continuation: null,
      snapshot: {
        processed: 5,
        success: 4,
        failed: 1,
        reclaimed: 0,
        skipped: 0,
        currentStep: 1,
        totalSteps: 1,
        detail: '执行完成',
        errors: [],
        oneKey: null,
      },
    })

    const handlers = await import('app/api/admin/translations/map-ops/route')
    const res = await handlers.POST(
      postReq({
        action: 'execute_round',
        statusScope: 'failed',
        limitPerType: 10,
        concurrency: 1,
      })
    )

    expect(res.status).toBe(200)
    expect(mocks.runMapOps).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'execute_round',
        targetLanguage: 'all',
        statusScope: 'failed',
        limitPerType: 10,
        concurrency: 1,
      })
    )

    const json = await res.json()
    expect(json).toMatchObject({
      ok: true,
      action: 'execute_round',
      snapshot: {
        processed: 5,
        success: 4,
      },
    })
  })
})
