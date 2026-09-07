import { describe, it, expect, vi, afterEach } from 'vitest'
import { runBillingReconcile } from '@/lib/billing/creem/reconcile'
import {
  MemoryBillingSubscriptionRepo,
  MemoryBillingWebhookEventRepo,
  MemoryUserTierRepo,
} from '@/lib/billing/creem/repoMemory'
import type { SubscriptionRecord } from '@/lib/billing/creem/repo'

/**
 * F2/F3/F8/F9/F12：每日对账。远端状态修正、404 熔断、失败事件重放、
 * 未到期取消的到期降档、合成事件审计。
 */

const NOW = new Date('2026-11-10T00:00:00Z')

function makeSubscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: 'rec_1',
    userId: 'u1',
    provider: 'creem',
    creemCustomerId: 'cus_1',
    creemSubscriptionId: 'sub_1',
    creemProductId: 'prod_1',
    tier: 'standard',
    status: 'active',
    currentPeriodStart: new Date('2026-09-06T00:00:00Z'),
    currentPeriodEnd: new Date('2026-10-06T00:00:00Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    lastEventAt: new Date('2026-09-06T00:00:00Z'),
    createdAt: new Date('2026-09-06T00:00:00Z'),
    updatedAt: new Date('2026-09-06T00:00:00Z'),
    ...overrides,
  }
}

function makeDeps() {
  return {
    subs: new MemoryBillingSubscriptionRepo(),
    users: new MemoryUserTierRepo(),
    events: new MemoryBillingWebhookEventRepo(),
    client: { getSubscription: vi.fn() },
    now: () => NOW,
    log: vi.fn(),
  }
}

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

afterEach(() => {
  consoleError.mockClear()
})

describe('runBillingReconcile', () => {
  it('远端 active：合成 subscription.paid 推进周期（既有行为）', async () => {
    const deps = makeDeps()
    deps.subs.seed(makeSubscription())
    deps.client.getSubscription.mockResolvedValue({
      id: 'sub_1',
      status: 'active',
      current_period_start_date: '2026-10-06T00:00:00Z',
      current_period_end_date: '2026-11-06T00:00:00Z',
    })
    const result = await runBillingReconcile(deps)
    expect(result).toMatchObject({ checked: 1, handled: 1, errors: 0, breakerTripped: false })
    const record = await deps.subs.findByCreemId('sub_1')
    expect(record?.currentPeriodEnd).toEqual(new Date('2026-11-06T00:00:00Z'))
    expect(deps.users.getUser('u1')?.tier).toBe('standard')
  })

  it('F8：远端 past_due 且周期已过 → 直接降档为 free，记录置 expired', async () => {
    const deps = makeDeps()
    deps.subs.seed(makeSubscription({ status: 'past_due' }))
    deps.client.getSubscription.mockResolvedValue({
      id: 'sub_1',
      status: 'past_due',
      current_period_end_date: '2026-10-06T00:00:00Z',
    })
    const result = await runBillingReconcile(deps)
    expect(result.handled).toBe(1)
    expect(deps.users.getUser('u1')?.tier).toBe('free')
    expect((await deps.subs.findByCreemId('sub_1'))?.status).toBe('expired')
  })

  it('F8：远端 canceled 但周期未过 → 不降档，走合成事件同步状态', async () => {
    const deps = makeDeps()
    deps.subs.seed(makeSubscription({ status: 'active', currentPeriodEnd: new Date('2026-11-06T00:00:00Z') }))
    deps.client.getSubscription.mockResolvedValue({
      id: 'sub_1',
      status: 'canceled',
      current_period_start_date: '2026-11-06T00:00:00Z',
      current_period_end_date: '2026-12-06T00:00:00Z',
    })
    const result = await runBillingReconcile(deps)
    expect(result.handled).toBe(1)
    expect(deps.users.getUser('u1')?.tier).not.toBe('free')
    expect((await deps.subs.findByCreemId('sub_1'))?.status).toBe('canceled')
  })

  it('F9：404 降档超过 max(3, ceil(候选×0.2)) → 熔断剩余 404 并 console.error', async () => {
    const deps = makeDeps()
    for (let i = 1; i <= 5; i += 1) {
      deps.subs.seed(makeSubscription({ id: `rec_${i}`, userId: `u${i}`, creemSubscriptionId: `sub_${i}`, creemCustomerId: `cus_${i}` }))
      deps.subs.seedUserTier(`u${i}`, 'standard')
    }
    deps.client.getSubscription.mockResolvedValue(null)
    const result = await runBillingReconcile(deps)

    expect(result.breakerTripped).toBe(true)
    expect(deps.client.getSubscription).toHaveBeenCalledTimes(5)
    const downgraded = ['u1', 'u2', 'u3', 'u4', 'u5'].filter((u) => deps.users.getUser(u)?.tier === 'free')
    expect(downgraded).toHaveLength(3)
    expect(consoleError).toHaveBeenCalledWith(
      '[billing/reconcile] circuit breaker tripped',
      expect.objectContaining({ limit: 3, candidates: 5 }),
    )
  })

  it('F9：404 数量在上限内 → 全部降档不熔断', async () => {
    const deps = makeDeps()
    deps.subs.seed(makeSubscription())
    deps.subs.seed(makeSubscription({ id: 'rec_2', userId: 'u2', creemSubscriptionId: 'sub_2', creemCustomerId: 'cus_2' }))
    deps.client.getSubscription.mockResolvedValue(null)
    const result = await runBillingReconcile(deps)
    expect(result.breakerTripped).toBe(false)
    expect(deps.users.getUser('u1')?.tier).toBe('free')
    expect(deps.users.getUser('u2')?.tier).toBe('free')
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('F2：canceled 已到期且用户仍非 free → 对账降档（不查远端）', async () => {
    const deps = makeDeps()
    deps.subs.seedUserTier('u1', 'standard')
    deps.subs.seed(makeSubscription({ status: 'canceled' }))
    const result = await runBillingReconcile(deps)
    expect(deps.client.getSubscription).not.toHaveBeenCalled()
    expect(deps.users.getUser('u1')?.tier).toBe('free')
    expect(result.handled).toBe(1)
  })

  it('F2：scheduled_cancel 到期但未过 48h 对账窗口 → 仍被降档', async () => {
    const deps = makeDeps()
    deps.subs.seedUserTier('u1', 'standard')
    deps.subs.seed(makeSubscription({ status: 'scheduled_cancel', currentPeriodEnd: new Date('2026-11-09T00:00:00Z') }))
    const result = await runBillingReconcile(deps)
    expect(deps.client.getSubscription).not.toHaveBeenCalled()
    expect(deps.users.getUser('u1')?.tier).toBe('free')
    expect(result.handled).toBe(1)
  })

  it('F2：用户已是 free → 不再进入降档候选', async () => {
    const deps = makeDeps()
    deps.subs.seedUserTier('u1', 'free')
    deps.subs.seed(makeSubscription({ status: 'canceled' }))
    const result = await runBillingReconcile(deps)
    expect(result.handled).toBe(0)
  })

  it('F3：对账重放处理失败的事件，成功后 processedAt 落库', async () => {
    const deps = makeDeps()
    await deps.events.claim({
      id: 'evt_fail',
      type: 'subscription.active',
      payload: {
        id: 'evt_fail',
        eventType: 'subscription.active',
        created_at: new Date('2026-11-06T00:00:00Z').getTime(),
        object: {
          id: 'sub_1',
          status: 'active',
          customer: { id: 'cus_1' },
          current_period_start_date: '2026-11-06T00:00:00Z',
          current_period_end_date: '2026-12-06T00:00:00Z',
          metadata: { userId: 'u1', tier: 'standard' },
        },
      },
    })
    await deps.events.markProcessed('evt_fail', 'db exploded')

    const result = await runBillingReconcile(deps)
    expect(result.replayed).toBe(1)
    const stored = deps.events.get('evt_fail')
    expect(stored?.processedAt).not.toBeNull()
    expect((await deps.subs.findByCreemId('sub_1'))?.status).toBe('active')
    expect(deps.users.getUser('u1')?.tier).toBe('standard')
  })

  it('F12：对账合成事件以 reconcile. 前缀落 events 审计', async () => {
    const deps = makeDeps()
    deps.subs.seed(makeSubscription())
    deps.client.getSubscription.mockResolvedValue({
      id: 'sub_1',
      status: 'active',
      current_period_start_date: '2026-10-06T00:00:00Z',
      current_period_end_date: '2026-11-06T00:00:00Z',
    })
    const claimSpy = vi.spyOn(deps.events, 'claim')
    const markSpy = vi.spyOn(deps.events, 'markProcessed')
    await runBillingReconcile(deps)

    expect(claimSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'reconcile.subscription.paid' }))
    expect(markSpy).toHaveBeenCalled()
    const claimed = claimSpy.mock.calls[0]?.[0]
    expect(claimed?.id).toMatch(/^reconcile_rec_1_\d+$/)
    expect(claimed && (claimed as { payload: { eventType: string } }).payload.eventType).toBe('subscription.paid')
  })

  it('处理单条失败 → errors 计数，其余继续', async () => {
    const deps = makeDeps()
    deps.subs.seed(makeSubscription())
    deps.subs.seed(makeSubscription({ id: 'rec_2', userId: 'u2', creemSubscriptionId: 'sub_2', creemCustomerId: 'cus_2' }))
    deps.client.getSubscription
      .mockRejectedValueOnce(new Error('creem down'))
      .mockResolvedValueOnce({ id: 'sub_2', status: 'active', current_period_end_date: '2026-11-06T00:00:00Z' })
    const result = await runBillingReconcile(deps)
    expect(result.errors).toBe(1)
    expect(result.checked).toBe(2)
  })
})
