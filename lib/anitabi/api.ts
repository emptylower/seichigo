import type { Session } from 'next-auth'
import { prisma } from '@/lib/db/prisma'

export type AnitabiApiDeps = {
  prisma: typeof prisma
  getSession: () => Promise<Session | null>
  now: () => Date
  getCronSecret: () => string
  getApiBase: () => string
  getSiteBase: () => string
}

let cached: AnitabiApiDeps | null = null

export async function getAnitabiApiDeps(): Promise<AnitabiApiDeps> {
  if (cached) return cached

  const { getServerAuthSession } = await import('@/lib/auth/session')

  cached = {
    prisma,
    getSession: getServerAuthSession,
    now: () => new Date(),
    getCronSecret: () => String(process.env.ANITABI_CRON_SECRET || process.env.OPS_CRON_SECRET || process.env.CRON_SECRET || '').trim(),
    getApiBase: () => String(process.env.ANITABI_API_BASE_URL || 'https://api.anitabi.cn').replace(/\/+$/, ''),
    getSiteBase: () => String(process.env.ANITABI_SITE_BASE_URL || 'https://www.anitabi.cn').replace(/\/+$/, ''),
  }

  return cached
}
