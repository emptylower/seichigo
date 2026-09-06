import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import type { Tier } from '@/lib/billing/tiers'
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  WEBHOOK_MAX_ATTEMPTS,
  type BillingSubscriptionRepo,
  type BillingWebhookEventRepo,
  type SubscriptionRecord,
  type UserTierRepo,
} from './repo'

type UpsertInput = Omit<SubscriptionRecord, 'id' | 'createdAt' | 'updatedAt'>

/** prisma 实现：与 memory 实现语义一致，供生产装配（serverDeps）使用 */

/** F2：对账降档候选状态 */
const EXPIRED_PENDING_STATUSES: readonly string[] = ['canceled', 'expired', 'scheduled_cancel']

export class PrismaBillingSubscriptionRepo implements BillingSubscriptionRepo {
  async findByCreemId(id: string): Promise<SubscriptionRecord | null> {
    return prisma.billingSubscription.findUnique({ where: { creemSubscriptionId: id } })
  }

  async findActiveByUser(userId: string): Promise<SubscriptionRecord | null> {
    return prisma.billingSubscription.findFirst({
      where: { userId, status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] } },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async listNeedingReconcile(olderThan: Date): Promise<SubscriptionRecord[]> {
    return prisma.billingSubscription.findMany({
      where: { status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] } , currentPeriodEnd: { lt: olderThan } },
      orderBy: { currentPeriodEnd: 'asc' },
    })
  }

  async listExpiredPendingDowngrade(now: Date): Promise<SubscriptionRecord[]> {
    return prisma.billingSubscription.findMany({
      where: {
        status: { in: [...EXPIRED_PENDING_STATUSES] },
        currentPeriodEnd: { lte: now },
        user: { tier: { not: 'free' } },
      },
      orderBy: { currentPeriodEnd: 'asc' },
    })
  }

  async upsert(record: UpsertInput): Promise<SubscriptionRecord> {
    const data = {
      userId: record.userId,
      provider: record.provider,
      creemCustomerId: record.creemCustomerId,
      creemSubscriptionId: record.creemSubscriptionId,
      creemProductId: record.creemProductId,
      tier: record.tier,
      status: record.status,
      currentPeriodStart: record.currentPeriodStart,
      currentPeriodEnd: record.currentPeriodEnd,
      cancelAtPeriodEnd: record.cancelAtPeriodEnd,
      canceledAt: record.canceledAt,
      lastEventAt: record.lastEventAt,
    }
    return prisma.billingSubscription.upsert({ where: { creemSubscriptionId: record.creemSubscriptionId }, create: data, update: data })
  }
}

export class PrismaBillingWebhookEventRepo implements BillingWebhookEventRepo {
  async claim(event: { id: string; type: string; payload: unknown }): Promise<'new' | 'duplicate'> {
    try {
      await prisma.billingWebhookEvent.create({
        data: { id: event.id, type: event.type, payload: event.payload as Prisma.InputJsonValue },
      })
      return 'new'
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') return 'duplicate'
      throw err
    }
  }

  async markProcessed(id: string, error?: string): Promise<void> {
    if (error === undefined) {
      await prisma.billingWebhookEvent.update({ where: { id }, data: { processedAt: new Date(), error: null } })
      return
    }
    // F3：失败不写 processedAt，attempts + 1，等待对账重放
    await prisma.billingWebhookEvent.update({ where: { id }, data: { error, attempts: { increment: 1 } } })
  }

  async listUnprocessed(limit: number): Promise<Array<{ id: string; type: string; payload: unknown }>> {
    return prisma.billingWebhookEvent.findMany({
      where: { processedAt: null, attempts: { lt: WEBHOOK_MAX_ATTEMPTS } },
      orderBy: { receivedAt: 'asc' },
      take: limit,
      select: { id: true, type: true, payload: true },
    })
  }

  async findRecentByType(type: string, userId: string, withinMs: number): Promise<boolean> {
    const count = await prisma.billingWebhookEvent.count({
      where: {
        type,
        receivedAt: { gte: new Date(Date.now() - withinMs) },
        payload: { path: ['userId'], equals: userId },
      },
    })
    return count > 0
  }
}

export class PrismaUserTierRepo implements UserTierRepo {
  async findUserIdByEmail(email: string): Promise<string | null> {
    // F4：大小写不敏感
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })
    return user?.id ?? null
  }

  async applyTier(input: {
    userId: string
    tier: Tier
    periodAnchor?: Date
    periodStart: Date
    periodEnd: Date
  }): Promise<void> {
    // 设计 §4：User 改写持与账本/beginAgentRun 相同的 pg_advisory_xact_lock
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))::text`
        await tx.user.update({
          where: { id: input.userId },
          data: {
            tier: input.tier,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            ...(input.periodAnchor ? { periodAnchor: input.periodAnchor } : {}),
          },
        })
      },
      { maxWait: 10_000, timeout: 15_000 },
    )
  }
}
