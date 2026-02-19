import type { Session } from 'next-auth'
import type { UserPointStateRepo } from '@/lib/userPointState/repo'

export type UserPointStateApiDeps = {
  repo: UserPointStateRepo
  getSession: () => Promise<Session | null>
  now: () => Date
}

let cached: UserPointStateApiDeps | null = null

export async function getUserPointStateApiDeps(): Promise<UserPointStateApiDeps> {
  if (cached) return cached

  const [{ PrismaUserPointStateRepo }, { getServerAuthSession }] = await Promise.all([
    import('@/lib/userPointState/repoPrisma'),
    import('@/lib/auth/session'),
  ])

  cached = {
    repo: new PrismaUserPointStateRepo(),
    getSession: getServerAuthSession,
    now: () => new Date(),
  }

  return cached
}
