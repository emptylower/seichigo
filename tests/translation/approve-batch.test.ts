import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    translationTask: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    anitabiBangumiI18n: {
      upsert: vi.fn(),
    },
    anitabiPointI18n: {
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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

function postReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/translations/approve-batch', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('approves ready map tasks and skips unsupported statuses', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    mocks.prisma.translationTask.findMany.mockResolvedValue([
      {
        id: 't1',
        entityType: 'anitabi_point',
        entityId: 'point-1',
        targetLanguage: 'en',
        status: 'ready',
        sourceHash: 'hash-point',
        sourceContent: { name: '站点', note: '备注' },
        draftContent: { name: 'Spot', note: 'Note' },
      },
      {
        id: 't2',
        entityType: 'anitabi_bangumi',
        entityId: '1',
        targetLanguage: 'ja',
        status: 'pending',
        sourceHash: null,
        sourceContent: { title: '原题', description: null, city: null },
        draftContent: { title: '原題', description: null, city: null },
      },
    ])

    mocks.prisma.anitabiPointI18n.upsert.mockResolvedValue({})
    mocks.prisma.translationTask.update.mockResolvedValue({})

    const handlers = await import('app/api/admin/translations/approve-batch/route')
    const res = await handlers.POST(
      postReq('http://localhost/api/admin/translations/approve-batch', {
        taskIds: ['t1', 't2', 'missing'],
      })
    )

    expect(res.status).toBe(200)
    const j = await res.json()

    expect(j).toMatchObject({
      ok: true,
      total: 3,
      approved: 1,
      skipped: 2,
      failed: 0,
    })
    expect(mocks.prisma.anitabiPointI18n.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.translationTask.update).toHaveBeenCalledTimes(1)
  })
})
