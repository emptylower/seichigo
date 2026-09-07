import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MemoryBillingCheckoutIntentRepo,
  MemoryBillingSubscriptionRepo,
  MemoryBillingWebhookEventRepo,
  MemoryUserTierRepo,
} from '@/lib/billing/creem/repoMemory'
import type { SubscriptionRecord } from '@/lib/billing/creem/repo'
import type { CreemConfig } from '@/lib/billing/creem/client'

/**
 * F5/F11 + nit：POST /api/me/billing/checkout。
 * success_url 用站点权威地址；并发结账 60 秒去重；409 只对 active/trialing 生效。
 * F（2026-09-07）：开关关闭 403 checkout_disabled + 记付费意向；开启照常结账。
 */

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCreemDeps: vi.fn(),
  getCreemRepos: vi.fn(),
  getLocale: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/billing/creem/serverDeps', () => ({
  getCreemDeps: () => mocks.getCreemDeps(),
  getCreemRepos: () => mocks.getCreemRepos(),
}))

vi.mock('@/lib/i18n/getLocale', () => ({
  getLocale: () => mocks.getLocale(),
}))

import { POST } from '@/app/api/me/billing/checkout/route'

const CONFIG: CreemConfig = {
  apiKey: 'k',
  apiBase: 'https://test-api.creem.io',
  productStandardId: 'prod_standard',
  webhookSecret: 'whsec_test',
}

function activeSubscription(status: string): SubscriptionRecord {
  const now = new Date('2026-09-10T00:00:00Z')
  return {
    id: 'rec_1',
    userId: 'u1',
    provider: 'creem',
    creemCustomerId: 'cus_1',
    creemSubscriptionId: 'sub_1',
    creemProductId: 'prod_1',
    tier: 'standard',
    status,
    currentPeriodStart: now,
    currentPeriodEnd: new Date('2026-10-10T00:00:00Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    lastEventAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

function makeDeps(overrides?: { subs?: MemoryBillingSubscriptionRepo; events?: MemoryBillingWebhookEventRepo }) {
  const createCheckout = vi.fn().mockResolvedValue({ id: 'ch_1', checkoutUrl: 'https://test.creem.io/checkout/ch_1' })
  const deps = {
    config: CONFIG,
    client: { createCheckout },
    subs: overrides?.subs ?? new MemoryBillingSubscriptionRepo(),
    events: overrides?.events ?? new MemoryBillingWebhookEventRepo(),
    users: new MemoryUserTierRepo(),
  }
  return { deps, createCheckout }
}

function request(): Request {
  return new Request('http://evil.example.com/api/me/billing/checkout', { method: 'POST' })
}

function requestWithBody(body: string): Request {
  return new Request('http://evil.example.com/api/me/billing/checkout', { method: 'POST', body })
}

beforeEach(() => {
  mocks.getSession.mockReset()
  mocks.getSession.mockResolvedValue({ user: { id: 'u1', email: 'u@example.com' } })
  mocks.getCreemDeps.mockReset()
  mocks.getCreemRepos.mockReset()
  mocks.getLocale.mockReset()
  mocks.getLocale.mockResolvedValue('zh')
  // 既有用例默认"开关打开"世界；开关专项用例自行覆盖/删除
  vi.stubEnv('BILLING_CHECKOUT_ENABLED', '1')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/me/billing/checkout', () => {
  it('F5：successUrl 用站点权威地址（SITE_URL），不取请求 origin', async () => {
    vi.stubEnv('SITE_URL', 'https://seichigo.com')
    const { deps, createCheckout } = makeDeps()
    mocks.getCreemDeps.mockReturnValue(deps)

    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(createCheckout).toHaveBeenCalledOnce()
    const input = createCheckout.mock.calls[0][0] as { successUrl: string; requestId: string }
    expect(input.successUrl).toBe('https://seichigo.com/me?billing=success')
    expect(input.successUrl).not.toContain('evil.example.com')
    expect(input.requestId).toMatch(/^u1:[0-9a-f-]{36}$/)
  })

  it('F5：未设 SITE_URL 的测试环境回退 localhost', async () => {
    const { deps, createCheckout } = makeDeps()
    mocks.getCreemDeps.mockReturnValue(deps)
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect((createCheckout.mock.calls[0][0] as { successUrl: string }).successUrl).toBe(
      'http://localhost:3000/me?billing=success',
    )
  })

  it('F11：60 秒内已有同用户 checkout.requested → 429 checkout_in_progress', async () => {
    const { deps, createCheckout } = makeDeps()
    const findRecentByType = vi.fn().mockResolvedValue(true)
    ;(deps.events as { findRecentByType: unknown }).findRecentByType = findRecentByType
    mocks.getCreemDeps.mockReturnValue(deps)

    const res = await POST(request())
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toEqual({ code: 'checkout_in_progress' })
    expect(createCheckout).not.toHaveBeenCalled()
  })

  it('F11：结账前落 checkout.requested 审计记录（processedAt 已写）', async () => {
    const { deps } = makeDeps()
    mocks.getCreemDeps.mockReturnValue(deps)

    const res = await POST(request())
    expect(res.status).toBe(200)
    const stored = [...(deps.events as unknown as { events: Map<string, { type: string; processedAt: Date | null; payload: unknown }> }).events.values()]
      .filter((e) => e.type === 'checkout.requested')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.processedAt).not.toBeNull()
    expect(stored[0]?.payload).toEqual({ userId: 'u1' })
  })

  it('活跃订阅（active）→ 409 already_subscribed', async () => {
    const subs = new MemoryBillingSubscriptionRepo()
    subs.seed(activeSubscription('active'))
    const { deps, createCheckout } = makeDeps({ subs })
    mocks.getCreemDeps.mockReturnValue(deps)

    const res = await POST(request())
    expect(res.status).toBe(409)
    expect(createCheckout).not.toHaveBeenCalled()
  })

  it('nit：past_due / scheduled_cancel 不再 409，可重新结账', async () => {
    for (const status of ['past_due', 'scheduled_cancel']) {
      const subs = new MemoryBillingSubscriptionRepo()
      subs.seed(activeSubscription(status))
      const { deps, createCheckout } = makeDeps({ subs })
      mocks.getCreemDeps.mockReturnValue(deps)

      const res = await POST(request())
      expect(res.status).toBe(200)
      expect(createCheckout).toHaveBeenCalledOnce()
    }
  })

  it('未登录 → 401；billing 未配置 → 503', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await POST(request())
    expect(res.status).toBe(401)

    mocks.getSession.mockResolvedValue({ user: { id: 'u1', email: 'u@example.com' } })
    mocks.getCreemDeps.mockReturnValue(null)
    const res2 = await POST(request())
    expect(res2.status).toBe(503)
  })
})

describe('POST /api/me/billing/checkout（订阅开关与付费意向，2026-09-07 Part F）', () => {
  it('开关关闭：未登录 → 403 checkout_disabled 且记一条 gated 意向（userId null）', async () => {
    vi.stubEnv('BILLING_CHECKOUT_ENABLED', '0')
    const intents = new MemoryBillingCheckoutIntentRepo()
    mocks.getCreemRepos.mockReturnValue({ intents })
    mocks.getSession.mockResolvedValue(null)

    const res = await POST(requestWithBody('{"source":"pricing"}'))
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ code: 'checkout_disabled' })
    expect(intents.list()).toHaveLength(1)
    expect(intents.list()[0]).toMatchObject({
      userId: null,
      tier: 'standard',
      source: 'pricing',
      locale: 'zh',
      gated: true,
    })
  })

  it('开关关闭：已登录 → 403 且记 gated 意向；不依赖 Creem 配置（不调 getCreemDeps）', async () => {
    vi.stubEnv('BILLING_CHECKOUT_ENABLED', '0')
    const intents = new MemoryBillingCheckoutIntentRepo()
    mocks.getCreemRepos.mockReturnValue({ intents })

    const res = await POST(request())
    expect(res.status).toBe(403)
    expect(mocks.getCreemDeps).not.toHaveBeenCalled()
    expect(intents.list()).toHaveLength(1)
    expect(intents.list()[0]).toMatchObject({ userId: 'u1', gated: true, source: 'unknown' })
  })

  it('开关关闭：非法 source 与非法 JSON 都归 unknown；locale 走请求语言', async () => {
    vi.stubEnv('BILLING_CHECKOUT_ENABLED', '0')
    mocks.getLocale.mockResolvedValue('en')
    const intents = new MemoryBillingCheckoutIntentRepo()
    mocks.getCreemRepos.mockReturnValue({ intents })

    await POST(requestWithBody('{"source":"banner"}'))
    await POST(requestWithBody('{bad json'))
    const rows = intents.list()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ source: 'unknown', locale: 'en' })
    expect(rows[1]).toMatchObject({ source: 'unknown', locale: 'en' })
  })

  it('开关开启：先记 gated:false 意向，再照常创建结账', async () => {
    const intents = new MemoryBillingCheckoutIntentRepo()
    mocks.getCreemRepos.mockReturnValue({ intents })
    const { deps, createCheckout } = makeDeps()
    mocks.getCreemDeps.mockReturnValue(deps)

    const res = await POST(requestWithBody('{"source":"profile"}'))
    expect(res.status).toBe(200)
    expect(createCheckout).toHaveBeenCalledOnce()
    expect(intents.list()).toHaveLength(1)
    expect(intents.list()[0]).toMatchObject({ userId: 'u1', source: 'profile', gated: false })
  })

  it('意向记录失败只 warn，不影响主流程（关闭期仍 403，开启期仍 200）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const intents: { record: () => Promise<void> } = { record: vi.fn().mockRejectedValue(new Error('db down')) }
    mocks.getCreemRepos.mockReturnValue({ intents })

    vi.stubEnv('BILLING_CHECKOUT_ENABLED', '0')
    const res = await POST(request())
    expect(res.status).toBe(403)

    vi.stubEnv('BILLING_CHECKOUT_ENABLED', '1')
    const { deps } = makeDeps()
    mocks.getCreemDeps.mockReturnValue(deps)
    const res2 = await POST(request())
    expect(res2.status).toBe(200)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
