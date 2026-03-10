import type { Session } from 'next-auth'
import { prisma } from '@/lib/db/prisma'

export type ArticleRepairApiDeps = {
  prisma: typeof prisma
  getSession: () => Promise<Session | null>
}

let cached: ArticleRepairApiDeps | null = null

export async function getArticleRepairApiDeps(): Promise<ArticleRepairApiDeps> {
  if (cached) return cached

  const { getServerAuthSession } = await import('@/lib/auth/session')
  cached = {
    prisma,
    getSession: getServerAuthSession,
  }

  return cached
}
