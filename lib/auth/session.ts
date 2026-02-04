import type { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { authOptions } from './options'

export async function getServerAuthSession(): Promise<Session | null> {
  const session = (await getServerSession(authOptions)) as Session | null
  if (session?.user?.disabled) return null
  return session
}
