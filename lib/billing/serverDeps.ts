import { PrismaUsageLedger } from './ledgerPrisma'
import { createBillingService, type BillingService } from './service'
import { PrismaBillingUsers } from './usersPrisma'

let cached: BillingService | null = null

export function getBillingService(): BillingService {
  if (!cached) cached = createBillingService({ ledger: new PrismaUsageLedger(), users: new PrismaBillingUsers() })
  return cached
}
