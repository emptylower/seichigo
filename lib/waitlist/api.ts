import type { Session } from 'next-auth'
import type { WaitlistRepo } from '@/lib/waitlist/repo'

export type WaitlistApiDeps = {
  repo: WaitlistRepo
  getSession: () => Promise<Session | null>
  now: () => Date
}

let cached: WaitlistApiDeps | null = null

export async function getWaitlistApiDeps(): Promise<WaitlistApiDeps> {
  if (cached) return cached

  const [{ PrismaWaitlistRepo }, { getServerAuthSession }] = await Promise.all([
    import('@/lib/waitlist/repoPrisma'),
    import('@/lib/auth/session'),
  ])

  cached = {
    repo: new PrismaWaitlistRepo(),
    getSession: getServerAuthSession,
    now: () => new Date(),
  }
  return cached
}
