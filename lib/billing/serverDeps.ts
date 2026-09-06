import { prisma } from '@/lib/db/prisma'
import { PrismaUsageLedger } from './ledgerPrisma'
import { createBillingService, type BillingService } from './service'
import { PrismaBillingUsers } from './usersPrisma'
import { PrismaBillingSubscriptionRepo } from './creem/repoPrisma'

let cached: BillingService | null = null

export function getBillingService(): BillingService {
  if (!cached) {
    cached = createBillingService({
      ledger: new PrismaUsageLedger(),
      users: new PrismaBillingUsers(),
      // F2：getAccount 读时兜底降档需要知道用户是否仍有活跃订阅
      subscriptions: new PrismaBillingSubscriptionRepo(),
      // G1：tripPlan.agentRunToken 仍等于 runRef → run 在跑，孤儿退款必须跳过
      isRunActive: async (planId, runRef) => (await prisma.tripPlan.count({ where: { id: planId, agentRunToken: runRef } })) > 0,
    })
  }
  return cached
}
