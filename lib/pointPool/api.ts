import type { Session } from 'next-auth'
import type { PointPoolRepo } from '@/lib/pointPool/repo'

export type PointPoolApiDeps = {
  repo: PointPoolRepo
  getSession: () => Promise<Session | null>
}

let cached: PointPoolApiDeps | null = null

export async function getPointPoolApiDeps(): Promise<PointPoolApiDeps> {
  if (cached) return cached

  const [{ PrismaPointPoolRepo }, { getServerAuthSession }] = await Promise.all([
    import('@/lib/pointPool/repoPrisma'),
    import('@/lib/auth/session'),
  ])

  cached = {
    repo: new PrismaPointPoolRepo(),
    getSession: getServerAuthSession,
  }

  return cached
}
