/**
 * Creem webhook 状态机（设计 2026-09-06 §4）：纯函数 + 注入仓储。
 * 路由层负责验签与按事件 id 幂等；这里只按 eventType 改写订阅记录与用户档位。
 */

import { addMonthsClamped, computePeriod } from '@/lib/billing/period'
import type { Tier } from '@/lib/billing/tiers'
import type { BillingSubscriptionRepo, SubscriptionRecord, UserTierRepo } from './repo'

export type CreemEvent = {
  id: string
  eventType: string
  created_at: number
  object: Record<string, unknown>
}

export function parseCreemEvent(raw: unknown): CreemEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.id !== 'string' || !obj.id.trim()) return null
  if (typeof obj.eventType !== 'string' || !obj.eventType.trim()) return null
  if (typeof obj.created_at !== 'number' || !Number.isFinite(obj.created_at)) return null
  if (!obj.object || typeof obj.object !== 'object' || Array.isArray(obj.object)) return null
  return { id: obj.id, eventType: obj.eventType, created_at: obj.created_at, object: obj.object as Record<string, unknown> }
}

function toDate(value: unknown): Date | null {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value) : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readMetadata(obj: Record<string, unknown>): Record<string, unknown> {
  const parsed = asRecord(obj.metadata)
  if (parsed) return parsed
  if (typeof obj.metadata === 'string') {
    try {
      return asRecord(JSON.parse(obj.metadata)) ?? {}
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * 用户解析顺序（设计 §4）：metadata.userId → request_id 前缀 "<userId>:" → customer.email 查库。
 */
export async function resolveUserId(event: CreemEvent, users: UserTierRepo): Promise<string | null> {
  const metadata = readMetadata(event.object)
  if (typeof metadata.userId === 'string' && metadata.userId.trim()) return metadata.userId
  const requestId = event.object.request_id
  if (typeof requestId === 'string') {
    const colon = requestId.indexOf(':')
    if (colon > 0) return requestId.slice(0, colon)
  }
  const customer = asRecord(event.object.customer)
  const email = customer && typeof customer.email === 'string' ? customer.email : null
  if (email) return users.findUserIdByEmail(email)
  return null
}

/**
 * 周期：start = current_period_start_date ?? last_transaction_date ?? fallbackNow；
 * end = current_period_end_date ?? next_transaction_date ?? addMonthsClamped(start, 1)。
 */
export function periodOf(obj: Record<string, unknown>, fallbackNow: Date): { start: Date; end: Date } {
  const start = toDate(obj.current_period_start_date) ?? toDate(obj.last_transaction_date) ?? fallbackNow
  const end = toDate(obj.current_period_end_date) ?? toDate(obj.next_transaction_date) ?? addMonthsClamped(start, 1)
  return { start, end }
}

/** 同步类事件的周期：事件缺字段时保底用既有记录，最后才造（不无谓改写已落库周期） */
function periodForSync(obj: Record<string, unknown>, existing: SubscriptionRecord | null, now: Date): { start: Date; end: Date } {
  const start = toDate(obj.current_period_start_date) ?? toDate(obj.last_transaction_date) ?? existing?.currentPeriodStart ?? now
  const end =
    toDate(obj.current_period_end_date) ??
    toDate(obj.next_transaction_date) ??
    existing?.currentPeriodEnd ??
    addMonthsClamped(start, 1)
  return { start, end }
}

const SUBSCRIPTION_EVENT_TYPES: readonly string[] = [
  'subscription.active',
  'subscription.trialing',
  'subscription.paid',
  'subscription.update',
  'subscription.scheduled_cancel',
  'subscription.past_due',
  'subscription.paused',
  'subscription.canceled',
  'subscription.expired',
]

export type HandleCreemEventDeps = {
  subs: BillingSubscriptionRepo
  users: UserTierRepo
  now?: () => Date
  log?: (level: 'warn' | 'error', msg: string, extra?: unknown) => void
}

function tierFromRecordTier(value: string): Tier {
  return value === 'pro' ? 'pro' : 'standard'
}

export async function handleCreemEvent(
  event: CreemEvent,
  deps: HandleCreemEventDeps,
): Promise<{ handled: boolean; note?: string }> {
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})

  if (event.eventType === 'checkout.completed') {
    // 设计 §4：只记录（BillingWebhookEvent 由路由层落库），档位变化等 subscription.active
    return { handled: true, note: 'checkout recorded' }
  }
  if (event.eventType === 'refund.created' || event.eventType === 'dispute.created') {
    log('error', `creem ${event.eventType} requires manual review`, { eventId: event.id })
    return { handled: true, note: `${event.eventType} recorded` }
  }
  if (!SUBSCRIPTION_EVENT_TYPES.includes(event.eventType)) return { handled: false }

  const obj = event.object
  const subId = typeof obj.id === 'string' ? obj.id : ''
  if (!subId) return { handled: false, note: 'missing subscription id' }

  const existing = await deps.subs.findByCreemId(subId)
  const resolved = await resolveUserId(event, deps.users)
  const candidateUserId = resolved ?? existing?.userId ?? null
  if (!candidateUserId) {
    log('error', 'creem event user unresolved', { eventId: event.id, eventType: event.eventType })
    return { handled: false, note: 'user unresolved' }
  }
  const userId: string = candidateUserId

  const metadata = readMetadata(obj)
  const customer = asRecord(obj.customer)
  const product = asRecord(obj.product)
  const recordTier: string = existing?.tier ?? (typeof metadata.tier === 'string' && metadata.tier ? metadata.tier : 'standard')
  const tier: Tier = tierFromRecordTier(recordTier)
  const canceledAt = toDate(obj.canceled_at) ?? existing?.canceledAt ?? null
  const statusOf = (fallback: string): string => (typeof obj.status === 'string' && obj.status ? obj.status : fallback)

  async function save(status: string, period: { start: Date; end: Date }, cancelAtPeriodEnd: boolean): Promise<void> {
    await deps.subs.upsert({
      userId,
      provider: 'creem',
      creemCustomerId: (customer && typeof customer.id === 'string' && customer.id) || existing?.creemCustomerId || '',
      creemSubscriptionId: subId,
      creemProductId: (product && typeof product.id === 'string' && product.id) || existing?.creemProductId || '',
      tier: recordTier,
      status,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd,
      canceledAt,
      lastEventAt: now(),
    })
  }

  /** 降免费：anchor = now，周期 = computePeriod(now, now)（设计 §4） */
  async function downgradeToFree(): Promise<void> {
    const at = now()
    const period = computePeriod(at, at)
    await deps.users.applyTier({ userId, tier: 'free', periodAnchor: at, periodStart: period.periodStart, periodEnd: period.periodEnd })
  }

  switch (event.eventType) {
    case 'subscription.active':
    case 'subscription.trialing': {
      if (!existing) {
        // 设计 §7：同一用户重复购买，以新订阅为准并记 warn
        const current = await deps.subs.findActiveByUser(userId)
        if (current && current.creemSubscriptionId !== subId) {
          log('warn', 'second active creem subscription for user', { userId, previous: current.creemSubscriptionId, incoming: subId })
        }
      }
      const period = periodOf(obj, now())
      await save(statusOf(event.eventType.slice('subscription.'.length)), period, false)
      await deps.users.applyTier({ userId, tier, periodAnchor: period.start, periodStart: period.start, periodEnd: period.end })
      return { handled: true }
    }
    case 'subscription.paid': {
      // 续费：只推进周期（anchor 不动）；tier 若被人工改动一并纠正
      const period = periodOf(obj, now())
      await save(statusOf('active'), period, false)
      await deps.users.applyTier({ userId, tier, periodStart: period.start, periodEnd: period.end })
      return { handled: true }
    }
    case 'subscription.update': {
      const cancelAtPeriodEnd = typeof obj.cancel_at_period_end === 'boolean' ? obj.cancel_at_period_end : existing?.cancelAtPeriodEnd ?? false
      await save(statusOf(existing?.status ?? 'active'), periodForSync(obj, existing, now()), cancelAtPeriodEnd)
      return { handled: true }
    }
    case 'subscription.scheduled_cancel': {
      // 只标记 cancelAtPeriodEnd；档位与周期不变，到期由 expired 处理
      await save(statusOf(existing?.status ?? 'active'), periodForSync(obj, existing, now()), true)
      return { handled: true }
    }
    case 'subscription.past_due': {
      await save(statusOf('past_due'), periodForSync(obj, existing, now()), existing?.cancelAtPeriodEnd ?? false)
      return { handled: true }
    }
    case 'subscription.paused': {
      await save('paused', periodForSync(obj, existing, now()), existing?.cancelAtPeriodEnd ?? false)
      await downgradeToFree()
      return { handled: true }
    }
    case 'subscription.canceled':
    case 'subscription.expired': {
      const period = periodForSync(obj, existing, now())
      await save(statusOf(event.eventType.slice('subscription.'.length)), period, existing?.cancelAtPeriodEnd ?? false)
      if (period.end.getTime() <= now().getTime()) await downgradeToFree()
      return { handled: true }
    }
    default:
      return { handled: false }
  }
}
