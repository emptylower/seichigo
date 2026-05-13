import type { Session } from 'next-auth'
import type { JournalReadRepo } from './repo'

export type JournalApiDeps = {
  repo: JournalReadRepo
  getSession: () => Promise<Session | null>
  now: () => Date
}

let cached: JournalApiDeps | null = null

export async function getJournalApiDeps(): Promise<JournalApiDeps> {
  if (cached) return cached

  const [{ PrismaJournalReadRepo }, { getServerAuthSession }] = await Promise.all([
    import('@/lib/journal/repoPrisma'),
    import('@/lib/auth/session'),
  ])

  cached = {
    repo: new PrismaJournalReadRepo(),
    getSession: getServerAuthSession,
    now: () => new Date(),
  }
  return cached
}
