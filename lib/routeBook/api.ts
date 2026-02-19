import type { Session } from 'next-auth'
import type { RouteBookRepo } from '@/lib/routeBook/repo'

export type RouteBookApiDeps = {
  repo: RouteBookRepo
  getSession: () => Promise<Session | null>
  now: () => Date
}

let cached: RouteBookApiDeps | null = null

export async function getRouteBookApiDeps(): Promise<RouteBookApiDeps> {
  if (cached) return cached

  const [{ PrismaRouteBookRepo }, { getServerAuthSession }] = await Promise.all([
    import('@/lib/routeBook/repoPrisma'),
    import('@/lib/auth/session'),
  ])

  cached = {
    repo: new PrismaRouteBookRepo(),
    getSession: getServerAuthSession,
    now: () => new Date(),
  }

  return cached
}
