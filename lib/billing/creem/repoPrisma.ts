import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'
import type { Tier } from '@/lib/billing/tiers'
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  type BillingSubscriptionRepo,
  type BillingWebhookEventRepo,
  type SubscriptionRecord,
  type UserTierRepo,
} from './repo'

type UpsertInput = Omit<SubscriptionRecord, 'id' | 'createdAt' | 'updatedAt'>

/** prisma 实现：与 memory 实现语义一致，供生产装配（serverDeps）使用 */

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
    await prisma.billingWebhookEvent.update({ where: { id }, data: { processedAt: new Date(), error: error ?? null } })
  }
}

export class PrismaUserTierRepo implements UserTierRepo {
  async findUserIdByEmail(email: string): Promise<string | null> {
    const user = await prisma.user.findFirst({ where: { email }, select: { id: true } })
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
