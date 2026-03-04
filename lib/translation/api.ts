import type { Session } from 'next-auth'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import {
  getTranslationTaskStatsForAdmin,
  listTranslationTasksForAdmin,
  parseTranslationTaskListQuery,
  parseTranslationTaskStatsFilter,
} from '@/lib/translation/adminDashboard'
import { enqueueMapTranslationTasksForBackfill } from '@/lib/translation/mapTaskEnqueue'

export type TranslationApiDeps = {
  prisma: typeof prisma
  Prisma: typeof Prisma
  getSession: () => Promise<Session | null>
  parseTranslationTaskListQuery: typeof parseTranslationTaskListQuery
  listTranslationTasksForAdmin: typeof listTranslationTasksForAdmin
  parseTranslationTaskStatsFilter: typeof parseTranslationTaskStatsFilter
  getTranslationTaskStatsForAdmin: typeof getTranslationTaskStatsForAdmin
  enqueueMapTranslationTasksForBackfill: typeof enqueueMapTranslationTasksForBackfill
}

let cached: TranslationApiDeps | null = null

export async function getTranslationApiDeps(): Promise<TranslationApiDeps> {
  if (cached) return cached

  const { getServerAuthSession } = await import('@/lib/auth/session')

  cached = {
    prisma,
    Prisma,
    getSession: getServerAuthSession,
    parseTranslationTaskListQuery,
    listTranslationTasksForAdmin,
    parseTranslationTaskStatsFilter,
    getTranslationTaskStatsForAdmin,
    enqueueMapTranslationTasksForBackfill,
  }

  return cached
}
