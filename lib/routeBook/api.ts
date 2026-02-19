import type { Session } from 'next-auth'
import type { RouteBookRepo } from '@/lib/routeBook/repo'
import type { PointPoolRepo } from '@/lib/pointPool/repo'

export type RouteBookApiDeps = {
  repo: RouteBookRepo
  pointPoolRepo: PointPoolRepo
  getSession: () => Promise<Session | null>
  now: () => Date
}

let cached: RouteBookApiDeps | null = null

export async function getRouteBookApiDeps(): Promise<RouteBookApiDeps> {
  if (cached) return cached

  const [{ PrismaRouteBookRepo }, { PrismaPointPoolRepo }, { getServerAuthSession }] = await Promise.all([
    import('@/lib/routeBook/repoPrisma'),
    import('@/lib/pointPool/repoPrisma'),
    import('@/lib/auth/session'),
  ])

  cached = {
    repo: new PrismaRouteBookRepo(),
    pointPoolRepo: new PrismaPointPoolRepo(),
    getSession: getServerAuthSession,
    now: () => new Date(),
  }

  return cached
}
