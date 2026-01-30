import type { Session } from 'next-auth'
import type { ProfileRepo } from './repo'

export type ProfileApiDeps = {
  repo: ProfileRepo
  getSession: () => Promise<Session | null>
}

let cached: ProfileApiDeps | null = null

export async function getProfileApiDeps(): Promise<ProfileApiDeps> {
  if (cached) return cached

  const [{ PrismaProfileRepo }, { getServerAuthSession }] = await Promise.all([
    import('./repoPrisma'),
    import('@/lib/auth/session'),
  ])

  cached = {
    repo: new PrismaProfileRepo(),
    getSession: getServerAuthSession,
  }
  return cached
}
