import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  report: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/comment/api', () => ({
  getCommentApiDeps: () => ({}),
}))

vi.mock('@/lib/comment/handlers/commentReport', () => ({
  createHandlers: () => ({ report: mocks.report }),
}))

import { POST } from '@/app/api/comments/[id]/report/route'

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/comments/c1/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/comments/[id]/report', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('maps unauthenticated, invalid, missing, and duplicate reports to clear statuses', async () => {
    const cases = [
      [{ error: '请先登录' }, 401],
      [{ error: '举报原因无效' }, 400],
      [{ error: '评论不存在' }, 404],
      [{ error: '你已经举报过该评论' }, 409],
    ] as const

    for (const [result, expectedStatus] of cases) {
      mocks.report.mockResolvedValueOnce({ ok: false, ...result })
      const response = await POST(request({ reason: 'spam' }), { params: Promise.resolve({ id: 'c1' }) })
      expect(response.status).toBe(expectedStatus)
    }
  })

  it('returns created report on success', async () => {
    mocks.report.mockResolvedValue({
      ok: true,
      report: { id: 'r1', commentId: 'c1', reporterId: 'user-1', reason: 'spam' },
    })

    const response = await POST(request({ reason: 'spam' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ ok: true, report: { id: 'r1' } })
    expect(mocks.report).toHaveBeenCalledWith({ user: { id: 'user-1' } }, 'c1', 'spam')
  })
})
