import type { Session } from 'next-auth'
import { prisma } from '@/lib/db/prisma'

export type MapImageDiagApiDeps = {
  prisma: typeof prisma
  getSession: () => Promise<Session | null>
  now: () => Date
}

let cached: MapImageDiagApiDeps | null = null

export async function getMapImageDiagApiDeps(): Promise<MapImageDiagApiDeps> {
  if (cached) return cached

  const { getServerAuthSession } = await import('@/lib/auth/session')

  cached = {
    prisma,
    getSession: getServerAuthSession,
    now: () => new Date(),
  }

  return cached
}
