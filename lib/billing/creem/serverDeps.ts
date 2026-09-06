import { createCreemClient, readCreemConfig, type CreemClient, type CreemConfig } from './client'
import type { BillingSubscriptionRepo, BillingWebhookEventRepo, UserTierRepo } from './repo'
import { PrismaBillingSubscriptionRepo, PrismaBillingWebhookEventRepo, PrismaUserTierRepo } from './repoPrisma'

/** 生产装配（prisma 实现），缓存单例；测试用 vi.mock 替换 getCreemDeps。 */

export type CreemRepos = {
  subs: BillingSubscriptionRepo
  events: BillingWebhookEventRepo
  users: UserTierRepo
}

export type CreemDeps = CreemRepos & {
  config: CreemConfig
  client: CreemClient
}

let cachedRepos: CreemRepos | null = null

export function getCreemRepos(): CreemRepos {
  if (!cachedRepos) {
    cachedRepos = {
      subs: new PrismaBillingSubscriptionRepo(),
      events: new PrismaBillingWebhookEventRepo(),
      users: new PrismaUserTierRepo(),
    }
  }
  return cachedRepos
}

let cachedDeps: CreemDeps | null = null
let depsResolved = false

/** 配置不全返回 null（路由据此 503） */
export function getCreemDeps(): CreemDeps | null {
  if (!depsResolved) {
    depsResolved = true
    const config = readCreemConfig()
    cachedDeps = config ? { ...getCreemRepos(), config, client: createCreemClient(config) } : null
  }
  return cachedDeps
}
