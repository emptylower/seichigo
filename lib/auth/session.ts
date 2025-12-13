import type { Session } from 'next-auth'
import { getServerSession } from 'next-auth/next'
import { authOptions } from './options'

export function getServerAuthSession(): Promise<Session | null> {
  return getServerSession(authOptions) as Promise<Session | null>
}

