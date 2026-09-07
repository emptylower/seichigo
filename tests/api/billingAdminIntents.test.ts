import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CheckoutIntentStats } from '@/lib/billing/creem/repo'

/** F4（2026-09-07 Part F）：GET /api/admin/billing/intents——订阅意向统计（仅管理员） */

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCreemRepos: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/billing/creem/serverDeps', () => ({
  getCreemRepos: () => mocks.getCreemRepos(),
}))

import { GET } from '@/app/api/admin/billing/intents/route'

const STATS: CheckoutIntentStats = {
  total: 6,
  last24h: 1,
  last7d: 4,
  uniqueUsers: 3,
  anonymous: 1,
  byDay: [{ day: '2026-09-07', count: 1 }],
}

beforeEach(() => {
  mocks.getSession.mockReset()
  mocks.getCreemRepos.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/admin/billing/intents', () => {
  it('未登录 / 非管理员 → 403，不触发统计', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(403)

    mocks.getSession.mockResolvedValue({ user: { id: 'u1', isAdmin: false } })
    expect((await GET()).status).toBe(403)
    expect(mocks.getCreemRepos).not.toHaveBeenCalled()
  })

  it('管理员 → 返回 stats 与 checkoutEnabled（读开关环境变量）', async () => {
    const stats = vi.fn().mockResolvedValue(STATS)
    mocks.getCreemRepos.mockReturnValue({ intents: { stats } })
    mocks.getSession.mockResolvedValue({ user: { id: 'admin', isAdmin: true } })

    vi.stubEnv('BILLING_CHECKOUT_ENABLED', '0')
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ stats: STATS, checkoutEnabled: false })
    expect(stats).toHaveBeenCalledOnce()
    expect(stats.mock.calls[0][0]).toBeInstanceOf(Date)

    vi.stubEnv('BILLING_CHECKOUT_ENABLED', '1')
    const res2 = await GET()
    await expect(res2.json()).resolves.toMatchObject({ checkoutEnabled: true })
  })
})
