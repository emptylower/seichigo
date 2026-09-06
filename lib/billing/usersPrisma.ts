import { prisma } from '@/lib/db/prisma'
import { parseTier } from './tiers'
import type { BillingUser, BillingUserRepo } from './users'

export class PrismaBillingUsers implements BillingUserRepo {
  async get(userId: string): Promise<BillingUser | null> {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tier: true, periodStart: true, periodAnchor: true, periodEnd: true, isAdmin: true },
    })
    if (!row) return null
    return { id: row.id, tier: parseTier(row.tier), periodStart: row.periodStart, periodAnchor: row.periodAnchor, periodEnd: row.periodEnd, isAdmin: row.isAdmin }
  }
  async setPeriod(userId: string, periodStart: Date, periodEnd: Date): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { periodStart, periodEnd } })
  }
}
