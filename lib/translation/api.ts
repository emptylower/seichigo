import type { Session } from 'next-auth'
import { Prisma } from '@prisma/client/wasm'
import { prisma } from '@/lib/db/prisma'
import {
  getTranslationTaskStatsForAdmin,
  listTranslationTasksForAdmin,
  parseTranslationTaskListQuery,
  parseTranslationTaskStatsFilter,
} from '@/lib/translation/adminDashboard'
import {
  createTranslationTasksFromCoverage,
  listUntranslatedItemsForAdmin,
  parseAdminTranslationEntityType,
} from '@/lib/translation/adminCoverage'
import {
  deleteTranslationTask,
  getTranslatedArticleSlugBySource,
  getTranslationTaskDetail,
  getTranslationTaskHistory,
  updateTranslationTaskDraft,
} from '@/lib/translation/adminTasks'
import {
  executeTranslationTasks,
  parseExecutionConcurrency,
  translateTranslationTaskById,
} from '@/lib/translation/adminExecution'
import { enqueueMapTranslationTasksForBackfill } from '@/lib/translation/mapTaskEnqueue'
import {
  getTranslationMapSummary,
  parseMapSummaryTargetLanguage,
} from '@/lib/translation/adminMapSummary'
import {
  approveBatchMapTranslationTasks as approveMapTranslationTasksBatch,
  approveTranslationTaskById as approveTranslationTask,
  isHttpError as isTranslationHttpError,
  rollbackArticleTranslationTask as rollbackTranslationTask,
  updatePublishedTranslationTask as updatePublishedTask,
} from '@/lib/translation/adminApproval'

export type TranslationApiDeps = {
  prisma: typeof prisma
  Prisma: typeof Prisma
  getSession: () => Promise<Session | null>
  parseTranslationTaskListQuery: typeof parseTranslationTaskListQuery
  listTranslationTasksForAdmin: typeof listTranslationTasksForAdmin
  parseTranslationTaskStatsFilter: typeof parseTranslationTaskStatsFilter
  getTranslationTaskStatsForAdmin: typeof getTranslationTaskStatsForAdmin
  parseAdminTranslationEntityType: typeof parseAdminTranslationEntityType
  createTranslationTasksFromCoverage: typeof createTranslationTasksFromCoverage
  listUntranslatedItemsForAdmin: typeof listUntranslatedItemsForAdmin
  parseMapSummaryTargetLanguage: typeof parseMapSummaryTargetLanguage
  getTranslationMapSummary: typeof getTranslationMapSummary
  parseExecutionConcurrency: typeof parseExecutionConcurrency
  executeTranslationTasks: typeof executeTranslationTasks
  translateTranslationTaskById: typeof translateTranslationTaskById
  getTranslationTaskDetail: typeof getTranslationTaskDetail
  updateTranslationTaskDraft: typeof updateTranslationTaskDraft
  deleteTranslationTask: typeof deleteTranslationTask
  getTranslationTaskHistory: typeof getTranslationTaskHistory
  getTranslatedArticleSlugBySource: typeof getTranslatedArticleSlugBySource
  approveTranslationTask: typeof approveTranslationTask
  approveMapTranslationTasksBatch: typeof approveMapTranslationTasksBatch
  rollbackTranslationTask: typeof rollbackTranslationTask
  updatePublishedTask: typeof updatePublishedTask
  isTranslationHttpError: typeof isTranslationHttpError
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
    parseAdminTranslationEntityType,
    createTranslationTasksFromCoverage,
    listUntranslatedItemsForAdmin,
    parseMapSummaryTargetLanguage,
    getTranslationMapSummary,
    parseExecutionConcurrency,
    executeTranslationTasks,
    translateTranslationTaskById,
    getTranslationTaskDetail,
    updateTranslationTaskDraft,
    deleteTranslationTask,
    getTranslationTaskHistory,
    getTranslatedArticleSlugBySource,
    approveTranslationTask,
    approveMapTranslationTasksBatch,
    rollbackTranslationTask,
    updatePublishedTask,
    isTranslationHttpError,
    enqueueMapTranslationTasksForBackfill,
  }

  return cached
}
