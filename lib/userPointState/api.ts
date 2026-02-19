import type { Session } from 'next-auth'
import type { UserPointStateRepo } from '@/lib/userPointState/repo'
import type { PointPoolRepo } from '@/lib/pointPool/repo'
import type { RouteBookRepo } from '@/lib/routeBook/repo'

export type UserPointStateApiDeps = {
  repo: UserPointStateRepo
  pointPoolRepo: PointPoolRepo
  routeBookRepo: RouteBookRepo
  getSession: () => Promise<Session | null>
  now: () => Date
}

let cached: UserPointStateApiDeps | null = null

export async function getUserPointStateApiDeps(): Promise<UserPointStateApiDeps> {
  if (cached) return cached

  const [{ PrismaUserPointStateRepo }, { PrismaPointPoolRepo }, { PrismaRouteBookRepo }, { getServerAuthSession }] = await Promise.all([
    import('@/lib/userPointState/repoPrisma'),
    import('@/lib/pointPool/repoPrisma'),
    import('@/lib/routeBook/repoPrisma'),
    import('@/lib/auth/session'),
  ])

  cached = {
    repo: new PrismaUserPointStateRepo(),
    pointPoolRepo: new PrismaPointPoolRepo(),
    routeBookRepo: new PrismaRouteBookRepo(),
    getSession: getServerAuthSession,
    now: () => new Date(),
  }

  return cached
}
