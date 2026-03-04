import type { Session } from 'next-auth'
import { prisma } from '@/lib/db/prisma'

export type AdminApiDeps = {
  prisma: typeof prisma
  getSession: () => Promise<Session | null>
  now: () => Date
}

let cached: AdminApiDeps | null = null

export async function getAdminApiDeps(): Promise<AdminApiDeps> {
  if (cached) return cached

  const { getServerAuthSession } = await import('@/lib/auth/session')

  cached = {
    prisma,
    getSession: getServerAuthSession,
    now: () => new Date(),
  }

  return cached
}
