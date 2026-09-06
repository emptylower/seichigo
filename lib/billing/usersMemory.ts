import type { BillingUser, BillingUserRepo } from './users'

export class MemoryBillingUsers implements BillingUserRepo {
  private users = new Map<string, BillingUser>()
  seed(user: BillingUser): void {
    this.users.set(user.id, { ...user })
  }
  async get(userId: string): Promise<BillingUser | null> {
    const u = this.users.get(userId)
    return u ? { ...u } : null
  }
  async setPeriod(userId: string, periodStart: Date, periodEnd: Date): Promise<void> {
    const u = this.users.get(userId)
    if (u) this.users.set(userId, { ...u, periodStart, periodEnd })
  }
  async setTier(userId: string, tier: BillingUser['tier'], periodAnchor: Date, periodStart: Date, periodEnd: Date): Promise<void> {
    const u = this.users.get(userId)
    if (u) this.users.set(userId, { ...u, tier, periodAnchor, periodStart, periodEnd })
  }
}
