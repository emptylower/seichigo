import type { Tier } from '@/lib/billing/tiers'
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  type BillingSubscriptionRepo,
  type BillingWebhookEventRepo,
  type SubscriptionRecord,
  type UserTierRepo,
} from './repo'

/** memory 仓储（测试用）：与 prisma 实现语义一致 */

type UpsertInput = Omit<SubscriptionRecord, 'id' | 'createdAt' | 'updatedAt'>

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}_mem_${idCounter}_${Math.random().toString(36).slice(2, 8)}`
}

export class MemoryBillingSubscriptionRepo implements BillingSubscriptionRepo {
  private rows = new Map<string, SubscriptionRecord>()
  private order = new Map<string, number>()
  private seq = 0

  seed(record: SubscriptionRecord): void {
    this.seq += 1
    this.order.set(record.id, this.seq)
    this.rows.set(record.id, { ...record })
  }

  private copy(record: SubscriptionRecord): SubscriptionRecord {
    return { ...record, currentPeriodStart: new Date(record.currentPeriodStart), currentPeriodEnd: new Date(record.currentPeriodEnd), canceledAt: record.canceledAt ? new Date(record.canceledAt) : null, lastEventAt: new Date(record.lastEventAt), createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) }
  }

  private findByCreemIdSync(creemSubscriptionId: string): SubscriptionRecord | null {
    for (const record of this.rows.values()) {
      if (record.creemSubscriptionId === creemSubscriptionId) return record
    }
    return null
  }

  async findByCreemId(id: string): Promise<SubscriptionRecord | null> {
    const found = this.findByCreemIdSync(id)
    return found ? this.copy(found) : null
  }

  async findActiveByUser(userId: string): Promise<SubscriptionRecord | null> {
    const candidates = [...this.rows.values()]
      .filter((r) => r.userId === userId && ACTIVE_SUBSCRIPTION_STATUSES.includes(r.status))
      .sort((a, b) => (this.order.get(b.id) ?? 0) - (this.order.get(a.id) ?? 0))
    return candidates[0] ? this.copy(candidates[0]) : null
  }

  async listNeedingReconcile(olderThan: Date): Promise<SubscriptionRecord[]> {
    return [...this.rows.values()]
      .filter((r) => ACTIVE_SUBSCRIPTION_STATUSES.includes(r.status) && r.currentPeriodEnd.getTime() < olderThan.getTime())
      .map((r) => this.copy(r))
  }

  async upsert(input: UpsertInput): Promise<SubscriptionRecord> {
    const existing = this.findByCreemIdSync(input.creemSubscriptionId)
    if (existing) {
      const next: SubscriptionRecord = { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date() }
      this.rows.set(next.id, next)
      return this.copy(next)
    }
    const now = new Date()
    this.seq += 1
    const record: SubscriptionRecord = { ...input, id: nextId('sub'), createdAt: now, updatedAt: now }
    this.order.set(record.id, this.seq)
    this.rows.set(record.id, record)
    return this.copy(record)
  }
}

type StoredWebhookEvent = {
  id: string
  type: string
  payload: unknown
  receivedAt: Date
  processedAt: Date | null
  error: string | null
}

export class MemoryBillingWebhookEventRepo implements BillingWebhookEventRepo {
  private events = new Map<string, StoredWebhookEvent>()

  get(id: string): StoredWebhookEvent | null {
    const found = this.events.get(id)
    return found ? { ...found } : null
  }

  async claim(event: { id: string; type: string; payload: unknown }): Promise<'new' | 'duplicate'> {
    if (this.events.has(event.id)) return 'duplicate'
    this.events.set(event.id, { ...event, receivedAt: new Date(), processedAt: null, error: null })
    return 'new'
  }

  async markProcessed(id: string, error?: string): Promise<void> {
    const stored = this.events.get(id)
    if (stored) {
      stored.processedAt = new Date()
      stored.error = error ?? null
    }
  }
}

export type MemoryUserTierState = { tier: Tier; periodAnchor: Date; periodStart: Date; periodEnd: Date }

export class MemoryUserTierRepo implements UserTierRepo {
  private emails = new Map<string, string>()
  private users = new Map<string, MemoryUserTierState>()
  /** 每次 applyTier 的调用记录（断言用） */
  readonly applied: Array<{ userId: string } & Partial<MemoryUserTierState> & { tier: Tier; periodStart: Date; periodEnd: Date }> = []

  seedEmail(email: string, userId: string): void {
    this.emails.set(email, userId)
  }

  seedUser(userId: string, state: MemoryUserTierState): void {
    this.users.set(userId, { ...state })
  }

  getUser(userId: string): MemoryUserTierState | null {
    const found = this.users.get(userId)
    return found ? { ...found } : null
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    return this.emails.get(email) ?? null
  }

  async applyTier(input: {
    userId: string
    tier: Tier
    periodAnchor?: Date
    periodStart: Date
    periodEnd: Date
  }): Promise<void> {
    const existing = this.users.get(input.userId)
    const anchor = input.periodAnchor ?? existing?.periodAnchor ?? input.periodStart
    this.users.set(input.userId, {
      tier: input.tier,
      periodAnchor: anchor,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    })
    this.applied.push({ ...input })
  }
}
