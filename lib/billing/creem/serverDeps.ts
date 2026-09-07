import { createCreemClient, readCreemConfig, type CreemClient, type CreemConfig } from './client'
import type {
  BillingCheckoutIntentRepo,
  BillingSubscriptionRepo,
  BillingWebhookEventRepo,
  UserTierRepo,
} from './repo'
import {
  PrismaBillingCheckoutIntentRepo,
  PrismaBillingSubscriptionRepo,
  PrismaBillingWebhookEventRepo,
  PrismaUserTierRepo,
} from './repoPrisma'

/** 生产装配（prisma 实现），缓存单例；测试用 vi.mock 替换 getCreemDeps。 */

export type CreemRepos = {
  subs: BillingSubscriptionRepo
  events: BillingWebhookEventRepo
  users: UserTierRepo
  /** F2 2026-09-07：付费意向（不依赖 Creem 配置，开关关闭期也照记） */
  intents: BillingCheckoutIntentRepo
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
      intents: new PrismaBillingCheckoutIntentRepo(),
    }
  }
  return cachedRepos
}

let cachedDeps: CreemDeps | null = null

/** 配置不全返回 null（路由据此 503）；nit：不缓存 null，配置补齐后无需重启进程 */
export function getCreemDeps(): CreemDeps | null {
  if (cachedDeps) return cachedDeps
  const config = readCreemConfig()
  if (!config) return null
  cachedDeps = { ...getCreemRepos(), config, client: createCreemClient(config) }
  return cachedDeps
}
