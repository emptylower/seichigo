import { describe, it, expect } from 'vitest'
import {
  MemoryBillingSubscriptionRepo,
  MemoryBillingWebhookEventRepo,
  MemoryUserTierRepo,
} from '@/lib/billing/creem/repoMemory'
import { addMonthsClamped } from '@/lib/billing/period'
import {
  handleCreemEvent,
  parseCreemEvent,
  periodOf,
  resolveUserId,
  type CreemEvent,
} from '@/lib/billing/creem/webhookHandler'

/**
 * D5：webhook 状态机（设计 §4）。全部用 memory 仓储；now 固定注入。
 */

const NOW = new Date('2026-09-10T00:00:00Z')
const T0_START = new Date('2026-09-06T00:00:00Z')
const T0_END = new Date('2026-10-06T00:00:00Z')
const T1_START = T0_END
const T1_END = new Date('2026-11-06T00:00:00Z')

type LogEntry = { level: 'warn' | 'error'; msg: string; extra?: unknown }

function makeDeps() {
  const subs = new MemoryBillingSubscriptionRepo()
  const users = new MemoryUserTierRepo()
  const events = new MemoryBillingWebhookEventRepo()
  const logs: LogEntry[] = []
  const deps = {
    subs,
    users,
    events,
    now: () => NOW,
    log: (level: 'warn' | 'error', msg: string, extra?: unknown) => logs.push({ level, msg, extra }),
  }
  return { ...deps, logs }
}

function subscriptionEvent(overrides: {
  id?: string
  subId?: string
  eventType?: string
  object?: Record<string, unknown>
  created_at?: number
}): CreemEvent {
  return {
    id: overrides.id ?? 'evt_1',
    eventType: overrides.eventType ?? 'subscription.active',
    created_at: overrides.created_at ?? T0_START.getTime(),
    object: {
      id: overrides.subId ?? 'sub_1',
      status: 'active',
      product: { id: 'prod_1', name: 'Standard' },
      customer: { id: 'cus_1', email: 'u@example.com' },
      current_period_start_date: T0_START.getTime(),
      current_period_end_date: T0_END.getTime(),
      metadata: { userId: 'u1', tier: 'standard' },
      ...(overrides.object ?? {}),
    },
  }
}

describe('parseCreemEvent', () => {
  it('合法事件解析成功', () => {
    const event = { id: 'evt_1', eventType: 'subscription.paid', created_at: 1728734327355, object: { id: 'sub_1' } }
    expect(parseCreemEvent(event)).toEqual(event)
  })

  it('缺 id/eventType/created_at/object 或类型不对返回 null', () => {
    expect(parseCreemEvent(null)).toBeNull()
    expect(parseCreemEvent('x')).toBeNull()
    expect(parseCreemEvent({ eventType: 'a', created_at: 1, object: {} })).toBeNull()
    expect(parseCreemEvent({ id: 'e', created_at: 1, object: {} })).toBeNull()
    expect(parseCreemEvent({ id: 'e', eventType: 'a', object: {} })).toBeNull()
    expect(parseCreemEvent({ id: 'e', eventType: 'a', created_at: 'not-number', object: {} })).toBeNull()
    expect(parseCreemEvent({ id: 'e', eventType: 'a', created_at: 1, object: 'not-object' })).toBeNull()
    expect(parseCreemEvent({ id: 'e', eventType: 'a', created_at: 1, object: [] })).toBeNull()
  })
})

describe('periodOf', () => {
  it('优先 current_period_*（毫秒 epoch）', () => {
    const obj = {
      current_period_start_date: T0_START.getTime(),
      current_period_end_date: T0_END.getTime(),
      last_transaction_date: T0_END.getTime() + 1,
      next_transaction_date: T0_END.getTime() + 2,
    }
    expect(periodOf(obj, NOW)).toEqual({ start: T0_START, end: T0_END })
  })

  it('F1：兼容 ISO 字符串日期', () => {
    const obj = {
      current_period_start_date: '2026-09-06T00:00:00Z',
      current_period_end_date: '2026-10-06T00:00:00Z',
    }
    expect(periodOf(obj, NOW)).toEqual({ start: T0_START, end: T0_END })
  })

  it('F1：秒级 epoch（< 1e12）自动 ×1000', () => {
    const obj = {
      current_period_start_date: Math.floor(T0_START.getTime() / 1000),
      current_period_end_date: Math.floor(T0_END.getTime() / 1000),
    }
    expect(periodOf(obj, NOW)).toEqual({ start: T0_START, end: T0_END })
  })

  it('F1：不可解析的字符串视为缺失', () => {
    const obj = { current_period_start_date: 'not-a-date', current_period_end_date: T0_END.getTime() }
    expect(periodOf(obj, NOW)).toEqual({ start: NOW, end: T0_END })
  })

  it('缺 current_period_* 时回退 last/next transaction', () => {
    const obj = { last_transaction_date: T0_START.getTime(), next_transaction_date: T0_END.getTime() }
    expect(periodOf(obj, NOW)).toEqual({ start: T0_START, end: T0_END })
  })

  it('周期字段全缺时 start=now，end=addMonthsClamped(start,1)', () => {
    expect(periodOf({}, NOW)).toEqual({ start: NOW, end: addMonthsClamped(NOW, 1) })
  })

  it('F1：落到兜底 now 分支时打 warn（含 eventId 与字段名）', () => {
    const logs: LogEntry[] = []
    periodOf({}, NOW, { eventId: 'evt_x', log: (level, msg, extra) => logs.push({ level, msg, extra }) })
    expect(logs).toEqual([
      { level: 'warn', msg: 'creem period fields missing, using fallback', extra: { eventId: 'evt_x', keys: [] } },
    ])
  })
})

describe('resolveUserId', () => {
  it('metadata.userId 优先', async () => {
    const users = new MemoryUserTierRepo()
    users.seedEmail('u@example.com', 'u-by-email')
    const event = subscriptionEvent({ object: { metadata: { userId: 'u-meta' }, customer: { id: 'cus_1', email: 'u@example.com' }, request_id: 'u-req:x' } })
    await expect(resolveUserId(event, users)).resolves.toBe('u-meta')
  })

  it('metadata 缺失时按 request_id 前缀回退', async () => {
    const users = new MemoryUserTierRepo()
    users.seedEmail('u@example.com', 'u-by-email')
    const event = subscriptionEvent({ object: { metadata: undefined, request_id: 'u-req:abc' } })
    await expect(resolveUserId(event, users)).resolves.toBe('u-req')
  })

  it('F4：allowEmailFallback 时按 customer.email 查库回退并打 warn；默认不允许回退', async () => {
    const users = new MemoryUserTierRepo()
    users.seedEmail('u@example.com', 'u-by-email')
    const event = subscriptionEvent({ object: { metadata: undefined } })
    await expect(resolveUserId(event, users)).resolves.toBeNull()
    const logs: LogEntry[] = []
    await expect(
      resolveUserId(event, users, {
        allowEmailFallback: true,
        log: (level, msg, extra) => logs.push({ level, msg, extra }),
      }),
    ).resolves.toBe('u-by-email')
    expect(logs).toEqual([{ level: 'warn', msg: 'resolved by email fallback', extra: { eventId: 'evt_1', subId: 'sub_1' } }])
  })

  it('F4：email 大小写不敏感匹配（memory 仓储 toLowerCase）', async () => {
    const users = new MemoryUserTierRepo()
    users.seedEmail('U@Example.COM', 'u-by-email')
    const event = subscriptionEvent({ object: { metadata: undefined, customer: { id: 'cus_1', email: 'u@example.com' } } })
    await expect(resolveUserId(event, users, { allowEmailFallback: true })).resolves.toBe('u-by-email')
  })

  it('都没有返回 null', async () => {
    const users = new MemoryUserTierRepo()
    const event = subscriptionEvent({ object: { metadata: undefined, customer: { id: 'cus_1' }, request_id: undefined } })
    await expect(resolveUserId(event, users)).resolves.toBeNull()
  })
})

describe('handleCreemEvent', () => {
  it('subscription.active：升标准档并设周期（anchor=周期起点）', async () => {
    const ctx = makeDeps()
    const result = await handleCreemEvent(subscriptionEvent({}), ctx)
    expect(result.handled).toBe(true)

    const record = await ctx.subs.findByCreemId('sub_1')
    expect(record).toMatchObject({
      userId: 'u1',
      provider: 'creem',
      creemCustomerId: 'cus_1',
      creemSubscriptionId: 'sub_1',
      creemProductId: 'prod_1',
      tier: 'standard',
      status: 'active',
      cancelAtPeriodEnd: false,
      canceledAt: null,
    })
    expect(record?.currentPeriodStart).toEqual(T0_START)
    expect(record?.currentPeriodEnd).toEqual(T0_END)

    expect(ctx.users.getUser('u1')).toEqual({
      tier: 'standard',
      periodAnchor: T0_START,
      periodStart: T0_START,
      periodEnd: T0_END,
    })
  })

  it('subscription.trialing：同 active 处理', async () => {
    const ctx = makeDeps()
    const result = await handleCreemEvent(subscriptionEvent({ eventType: 'subscription.trialing', object: { status: 'trialing' } }), ctx)
    expect(result.handled).toBe(true)
    expect(ctx.users.getUser('u1')?.tier).toBe('standard')
    expect(await ctx.subs.findByCreemId('sub_1')).toMatchObject({ status: 'trialing' })
  })

  it('subscription.paid：推进周期但锚点不变', async () => {
    const ctx = makeDeps()
    await handleCreemEvent(subscriptionEvent({}), ctx)
    const paid = await handleCreemEvent(
      subscriptionEvent({
        id: 'evt_2',
        eventType: 'subscription.paid',
        object: {
          current_period_start_date: T1_START.getTime(),
          current_period_end_date: T1_END.getTime(),
        },
      }),
      ctx,
    )
    expect(paid.handled).toBe(true)
    expect(ctx.users.getUser('u1')).toEqual({
      tier: 'standard',
      periodAnchor: T0_START,
      periodStart: T1_START,
      periodEnd: T1_END,
    })
    const record = await ctx.subs.findByCreemId('sub_1')
    expect(record?.currentPeriodStart).toEqual(T1_START)
    expect(record?.currentPeriodEnd).toEqual(T1_END)
  })

  it('subscription.scheduled_cancel：只标记 cancelAtPeriodEnd，不动档位与周期', async () => {
    const ctx = makeDeps()
    await handleCreemEvent(subscriptionEvent({}), ctx)
    const result = await handleCreemEvent(
      subscriptionEvent({ id: 'evt_2', eventType: 'subscription.scheduled_cancel', object: { status: 'scheduled_cancel' } }),
      ctx,
    )
    expect(result.handled).toBe(true)
    expect(await ctx.subs.findByCreemId('sub_1')).toMatchObject({ cancelAtPeriodEnd: true })
    expect(ctx.users.getUser('u1')?.tier).toBe('standard')
    expect(ctx.users.getUser('u1')?.periodEnd).toEqual(T0_END)
    expect(ctx.users.applied.length).toBe(1)
  })

  it('subscription.expired：周期已结束 → 降免费（anchor=now）', async () => {
    const ctx = makeDeps()
    ctx.now = () => new Date('2026-11-10T00:00:00Z')
    await handleCreemEvent(subscriptionEvent({}), ctx)
    const result = await handleCreemEvent(
      subscriptionEvent({
        id: 'evt_2',
        eventType: 'subscription.expired',
        object: {
          status: 'expired',
          current_period_start_date: T1_START.getTime(),
          current_period_end_date: T1_END.getTime(),
          canceled_at: T1_END.getTime(),
        },
      }),
      ctx,
    )
    expect(result.handled).toBe(true)
    const now = new Date('2026-11-10T00:00:00Z')
    expect(ctx.users.getUser('u1')).toEqual({
      tier: 'free',
      periodAnchor: now,
      periodStart: now,
      periodEnd: addMonthsClamped(now, 1),
    })
    expect(await ctx.subs.findByCreemId('sub_1')).toMatchObject({ status: 'expired' })
  })

  it('subscription.canceled：周期未结束 → 只更新记录不降档；缺 canceled_at 用 created_at 兜底', async () => {
    const ctx = makeDeps()
    await handleCreemEvent(subscriptionEvent({}), ctx)
    const result = await handleCreemEvent(
      subscriptionEvent({ id: 'evt_2', eventType: 'subscription.canceled', created_at: T0_END.getTime(), object: { status: 'canceled' } }),
      ctx,
    )
    expect(result.handled).toBe(true)
    expect(ctx.users.getUser('u1')?.tier).toBe('standard')
    expect(ctx.users.applied.length).toBe(1)
    expect(await ctx.subs.findByCreemId('sub_1')).toMatchObject({ status: 'canceled', canceledAt: T0_END })
  })

  it('subscription.paused：立即降免费', async () => {
    const ctx = makeDeps()
    await handleCreemEvent(subscriptionEvent({}), ctx)
    const result = await handleCreemEvent(
      subscriptionEvent({ id: 'evt_2', eventType: 'subscription.paused', object: { status: 'paused' } }),
      ctx,
    )
    expect(result.handled).toBe(true)
    expect(ctx.users.getUser('u1')).toEqual({
      tier: 'free',
      periodAnchor: NOW,
      periodStart: NOW,
      periodEnd: addMonthsClamped(NOW, 1),
    })
  })

  it('subscription.update：同步 status/周期，不改档位', async () => {
    const ctx = makeDeps()
    await handleCreemEvent(subscriptionEvent({}), ctx)
    const result = await handleCreemEvent(
      subscriptionEvent({
        id: 'evt_2',
        eventType: 'subscription.update',
        object: { status: 'active', current_period_start_date: T1_START.getTime(), current_period_end_date: T1_END.getTime() },
      }),
      ctx,
    )
    expect(result.handled).toBe(true)
    expect(ctx.users.applied.length).toBe(1)
    const record = await ctx.subs.findByCreemId('sub_1')
    expect(record?.currentPeriodStart).toEqual(T1_START)
    expect(record?.currentPeriodEnd).toEqual(T1_END)
  })

  it('subscription.past_due：记状态不改档位', async () => {
    const ctx = makeDeps()
    await handleCreemEvent(subscriptionEvent({}), ctx)
    const result = await handleCreemEvent(
      subscriptionEvent({ id: 'evt_2', eventType: 'subscription.past_due', object: { status: 'past_due' } }),
      ctx,
    )
    expect(result.handled).toBe(true)
    expect(ctx.users.getUser('u1')?.tier).toBe('standard')
    expect(await ctx.subs.findByCreemId('sub_1')).toMatchObject({ status: 'past_due' })
  })

  it('checkout.completed：只记录，不建订阅不改档位', async () => {
    const ctx = makeDeps()
    const result = await handleCreemEvent(
      {
        id: 'evt_ch',
        eventType: 'checkout.completed',
        created_at: T0_START.getTime(),
        object: { id: 'ch_1', order: {}, subscription: { id: 'sub_1' }, metadata: { userId: 'u1' } },
      },
      ctx,
    )
    expect(result.handled).toBe(true)
    expect(await ctx.subs.findByCreemId('sub_1')).toBeNull()
    expect(ctx.users.applied.length).toBe(0)
  })

  it('refund.created / dispute.created：记录并 error 告警，不改档位', async () => {
    const ctx = makeDeps()
    await handleCreemEvent(subscriptionEvent({}), ctx)
    for (const eventType of ['refund.created', 'dispute.created'] as const) {
      const result = await handleCreemEvent(
        { id: `evt_${eventType}`, eventType, created_at: T0_START.getTime(), object: { id: 'rf_1' } },
        ctx,
      )
      expect(result.handled).toBe(true)
    }
    expect(ctx.logs.filter((l) => l.level === 'error').length).toBe(2)
    expect(ctx.users.getUser('u1')?.tier).toBe('standard')
  })

  it('metadata 缺失按 request_id 回退；再缺失按 email 回退', async () => {
    const ctx = makeDeps()
    ctx.users.seedEmail('u@example.com', 'u1')
    const byRequestId = await handleCreemEvent(
      subscriptionEvent({ object: { metadata: undefined, request_id: 'u1:abc-1' } }),
      ctx,
    )
    expect(byRequestId.handled).toBe(true)
    expect((await ctx.subs.findByCreemId('sub_1'))?.userId).toBe('u1')

    const byEmail = await handleCreemEvent(
      subscriptionEvent({ subId: 'sub_2', id: 'evt_3', object: { metadata: undefined } }),
      ctx,
    )
    expect(byEmail.handled).toBe(true)
    expect((await ctx.subs.findByCreemId('sub_2'))?.userId).toBe('u1')
  })

  it('用户无法解析且无既有记录 → handled false 且 log error', async () => {
    const ctx = makeDeps()
    ctx.users.seedEmail('other@example.com', 'u2')
    const result = await handleCreemEvent(
      subscriptionEvent({ object: { metadata: undefined, request_id: undefined, customer: { id: 'cus_1' } } }),
      ctx,
    )
    expect(result.handled).toBe(false)
    expect(ctx.logs.some((l) => l.level === 'error')).toBe(true)
  })

  it('F11：同一用户第二条 active 订阅以新为准并 log error duplicate active subscription', async () => {
    const ctx = makeDeps()
    await handleCreemEvent(subscriptionEvent({}), ctx)
    const second = await handleCreemEvent(
      subscriptionEvent({ id: 'evt_2', subId: 'sub_2', object: { customer: { id: 'cus_2', email: 'u2@example.com' } } }),
      ctx,
    )
    expect(second.handled).toBe(true)
    const dup = ctx.logs.find((l) => l.msg === 'duplicate active subscription')
    expect(dup?.level).toBe('error')
    expect(dup?.extra).toEqual({ userId: 'u1', old: 'sub_1', new: 'sub_2' })
    expect(await ctx.subs.findActiveByUser('u1')).toMatchObject({ creemSubscriptionId: 'sub_2' })
  })

  it('F10：晚到的旧 expired 不覆盖新 active', async () => {
    const ctx = makeDeps()
    // 新 active（created_at 较晚）先到
    await handleCreemEvent(
      subscriptionEvent({
        id: 'evt_active',
        created_at: T1_START.getTime() + 1000,
        object: { current_period_start_date: T1_START.getTime(), current_period_end_date: T1_END.getTime() },
      }),
      ctx,
    )
    expect(ctx.users.getUser('u1')?.tier).toBe('standard')
    // 旧 expired（created_at 较早）后到 → stale 拒绝
    const stale = await handleCreemEvent(
      subscriptionEvent({
        id: 'evt_old',
        eventType: 'subscription.expired',
        created_at: T0_START.getTime(),
        object: { status: 'expired', current_period_start_date: T0_START.getTime(), current_period_end_date: T0_END.getTime() },
      }),
      ctx,
    )
    expect(stale).toEqual({ handled: false, note: 'stale event' })
    expect(ctx.users.getUser('u1')?.tier).toBe('standard')
    expect(ctx.users.getUser('u1')?.periodEnd).toEqual(T1_END)
    expect((await ctx.subs.findByCreemId('sub_1'))?.status).toBe('active')
  })

  it('F10：lastEventAt 改写为事件 created_at 而非 now', async () => {
    const ctx = makeDeps()
    await handleCreemEvent(
      subscriptionEvent({ id: 'evt_1', created_at: T0_START.getTime() }),
      ctx,
    )
    expect((await ctx.subs.findByCreemId('sub_1'))?.lastEventAt).toEqual(T0_START)
  })

  it('F4：canceled 事件缺 metadata 且 email 匹配他人 → handled false 且不改任何人', async () => {
    const ctx = makeDeps()
    ctx.users.seedEmail('attacker@example.com', 'victim')
    const result = await handleCreemEvent(
      subscriptionEvent({
        eventType: 'subscription.canceled',
        object: {
          metadata: undefined,
          request_id: undefined,
          status: 'canceled',
          customer: { id: 'cus_1', email: 'attacker@example.com' },
        },
      }),
      ctx,
    )
    expect(result.handled).toBe(false)
    expect(ctx.users.applied.length).toBe(0)
    expect(await ctx.subs.findByCreemId('sub_1')).toBeNull()
    expect(ctx.users.getUser('victim')).toBeNull()
  })

  it('F4：已有记录时以记录 userId 为准（email 指向他人也不覆盖）', async () => {
    const ctx = makeDeps()
    await handleCreemEvent(subscriptionEvent({}), ctx)
    ctx.users.seedEmail('other@example.com', 'u2')
    const result = await handleCreemEvent(
      subscriptionEvent({
        id: 'evt_2',
        eventType: 'subscription.paid',
        object: {
          metadata: undefined,
          request_id: undefined,
          customer: { id: 'cus_1', email: 'other@example.com' },
          current_period_start_date: T1_START.getTime(),
          current_period_end_date: T1_END.getTime(),
        },
      }),
      ctx,
    )
    expect(result.handled).toBe(true)
    expect((await ctx.subs.findByCreemId('sub_1'))?.userId).toBe('u1')
    expect(ctx.users.getUser('u1')?.tier).toBe('standard')
    expect(ctx.users.getUser('u2')).toBeNull()
  })

  it('未知事件类型 → handled false', async () => {
    const ctx = makeDeps()
    const result = await handleCreemEvent(
      { id: 'evt_x', eventType: 'payout.created', created_at: T0_START.getTime(), object: { id: 'sub_1' } },
      ctx,
    )
    expect(result.handled).toBe(false)
    expect(ctx.users.applied.length).toBe(0)
  })

  it('订阅事件缺 object.id → handled false', async () => {
    const ctx = makeDeps()
    const result = await handleCreemEvent(
      { id: 'evt_noid', eventType: 'subscription.active', created_at: T0_START.getTime(), object: { status: 'active' } },
      ctx,
    )
    expect(result.handled).toBe(false)
  })
})
