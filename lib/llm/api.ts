import { prisma } from '@/lib/db/prisma'
import { createPrismaLlmProviderRepo } from './repoPrisma'
import type { LlmProviderRepo } from './repo'
import type { LlmAdminApiDeps } from './handlers/adminProviders'

let cachedRepo: LlmProviderRepo | null = null
let cached: LlmAdminApiDeps | null = null

/** 管理面板 LLM 供应商 API 的依赖装配（Prisma repo 单例 + 会话）。 */
export async function getLlmAdminApiDeps(): Promise<LlmAdminApiDeps> {
  if (cached) return cached

  const { getServerAuthSession } = await import('@/lib/auth/session')

  if (!cachedRepo) {
    cachedRepo = createPrismaLlmProviderRepo(prisma)
  }

  cached = {
    getSession: getServerAuthSession,
    repo: cachedRepo,
    now: () => new Date(),
  }
  return cached
}
