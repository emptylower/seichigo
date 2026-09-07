import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  MemoryBillingCheckoutIntentRepo,
  MemoryBillingSubscriptionRepo,
  MemoryBillingWebhookEventRepo,
  MemoryUserTierRepo,
} from '@/lib/billing/creem/repoMemory'

/**
 * D6：POST /api/billing/creem/webhook。验签 401、形状 400、幂等 duplicate、
 * 处理异常仍 200 且 error 落库（设计 §5）。getCreemDeps 用 memory 仓储 mock。
 */

vi.mock('@/lib/billing/creem/serverDeps', () => ({
  getCreemDeps: vi.fn(),
}))

import { getCreemDeps } from '@/lib/billing/creem/serverDeps'
import { POST } from '@/app/api/billing/creem/webhook/route'
import type { CreemConfig } from '@/lib/billing/creem/client'

const SECRET = 'whsec_test'

function makeDeps(overrides?: { subs?: MemoryBillingSubscriptionRepo }) {
  return {
    config: {
      apiKey: 'k',
      apiBase: 'https://test-api.creem.io',
      productStandardId: 'p',
      webhookSecret: SECRET,
    } satisfies CreemConfig,
    client: {} as never,
    subs: overrides?.subs ?? new MemoryBillingSubscriptionRepo(),
    events: new MemoryBillingWebhookEventRepo(),
    users: new MemoryUserTierRepo(),
    intents: new MemoryBillingCheckoutIntentRepo(),
  }
}

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function webhookRequest(body: string, signature: string | null): Request {
  return new Request('http://localhost/api/billing/creem/webhook', {
    method: 'POST',
    body,
    headers: signature === null ? {} : { 'creem-signature': signature },
  })
}

const ACTIVE_EVENT = {
  id: 'evt_1',
  eventType: 'subscription.active',
  created_at: 1757116800000,
  object: {
    id: 'sub_1',
    status: 'active',
    product: { id: 'prod_1' },
    customer: { id: 'cus_1', email: 'u@example.com' },
    current_period_start_date: 1757116800000,
    current_period_end_date: 1759718400000,
    metadata: { userId: 'u1', tier: 'standard' },
  },
}

beforeEach(() => {
  vi.mocked(getCreemDeps).mockReset()
})

describe('POST /api/billing/creem/webhook', () => {
  it('配置缺失 → 503', async () => {
    vi.mocked(getCreemDeps).mockReturnValue(null)
    const res = await POST(webhookRequest('{}', sign('{}')))
    expect(res.status).toBe(503)
  })

  it('验签失败 → 401', async () => {
    const deps = makeDeps()
    vi.mocked(getCreemDeps).mockReturnValue(deps)
    const body = JSON.stringify(ACTIVE_EVENT)
    const res = await POST(webhookRequest(body, sign(body, 'wrong-secret')))
    expect(res.status).toBe(401)
    expect(deps.events.get('evt_1')).toBeNull()
  })

  it('缺少 creem-signature header → 401', async () => {
    const deps = makeDeps()
    vi.mocked(getCreemDeps).mockReturnValue(deps)
    const res = await POST(webhookRequest(JSON.stringify(ACTIVE_EVENT), null))
    expect(res.status).toBe(401)
  })

  it('body 不是 JSON → 400', async () => {
    const deps = makeDeps()
    vi.mocked(getCreemDeps).mockReturnValue(deps)
    const body = 'not-json'
    const res = await POST(webhookRequest(body, sign(body)))
    expect(res.status).toBe(400)
  })

  it('JSON 但事件形状不合法 → 400', async () => {
    const deps = makeDeps()
    vi.mocked(getCreemDeps).mockReturnValue(deps)
    const body = JSON.stringify({ hello: 'world' })
    const res = await POST(webhookRequest(body, sign(body)))
    expect(res.status).toBe(400)
  })

  it('合法事件 → 200，落库 processedAt，升档生效', async () => {
    const deps = makeDeps()
    vi.mocked(getCreemDeps).mockReturnValue(deps)
    const body = JSON.stringify(ACTIVE_EVENT)
    const res = await POST(webhookRequest(body, sign(body)))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    const stored = deps.events.get('evt_1')
    expect(stored?.type).toBe('subscription.active')
    expect(stored?.processedAt).not.toBeNull()
    expect(stored?.error).toBeNull()
    expect(await deps.subs.findByCreemId('sub_1')).toMatchObject({ userId: 'u1', status: 'active' })
    expect(deps.users.getUser('u1')?.tier).toBe('standard')
  })

  it('同一事件重投 → 200 { duplicate: true } 且不重复处理', async () => {
    const deps = makeDeps()
    vi.mocked(getCreemDeps).mockReturnValue(deps)
    const body = JSON.stringify(ACTIVE_EVENT)

    const first = await POST(webhookRequest(body, sign(body)))
    expect(first.status).toBe(200)
    expect(deps.users.applied.length).toBe(1)

    const second = await POST(webhookRequest(body, sign(body)))
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({ duplicate: true })
    expect(deps.users.applied.length).toBe(1)
  })

  it('F3：处理抛错 → 仍 200，error/attempts 落库且 processedAt 保持 null（待对账重放）', async () => {
    const subs = new MemoryBillingSubscriptionRepo()
    const original = subs.upsert.bind(subs)
    const boom = new Error('db exploded')
    vi.spyOn(subs, 'upsert').mockImplementation(async (input) => {
      if (input.creemSubscriptionId === 'sub_boom') throw boom
      return original(input)
    })
    const deps = makeDeps({ subs })
    vi.mocked(getCreemDeps).mockReturnValue(deps)

    const event = { ...ACTIVE_EVENT, id: 'evt_boom', object: { ...ACTIVE_EVENT.object, id: 'sub_boom' } }
    const body = JSON.stringify(event)
    const res = await POST(webhookRequest(body, sign(body)))

    expect(res.status).toBe(200)
    const stored = deps.events.get('evt_boom')
    expect(stored?.processedAt).toBeNull()
    expect(stored?.error).toContain('db exploded')
    expect(stored?.attempts).toBe(1)
    const unprocessed = await deps.events.listUnprocessed(10)
    expect(unprocessed.map((e) => e.id)).toContain('evt_boom')
  })
})
