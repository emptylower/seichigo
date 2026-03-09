import type { PrismaClient } from '@prisma/client'
import { executeMapTranslationTasks } from '@/lib/translation/mapTaskExecutor'
import { listTranslationTasksForAdmin } from '@/lib/translation/adminDashboard'
import {
  translateAnime,
  translateAnitabiBangumi,
  translateAnitabiPoint,
  translateArticle,
  translateCity,
} from '@/lib/translation/service'

export type TaskStatusScope = 'pending' | 'failed' | 'pending_or_failed'

export type ExecuteTranslationTasksInput = {
  taskIds?: string[]
  entityType?: string
  targetLanguage?: string
  q?: string | null
  limit?: number
  includeFailed?: boolean
  statusScope?: TaskStatusScope
  concurrency?: number
}

export type ExecuteTranslationTaskResult = {
  taskId: string
  status: 'ready' | 'failed' | 'skipped'
  error?: string
}

export type ExecuteTranslationTasksResult = {
  reclaimedProcessing: number
  total: number
  processed: number
  success: number
  failed: number
  skipped: number
  results: ExecuteTranslationTaskResult[]
}

type TaskRow = {
  id: string
  entityType: string
  entityId: string
  targetLanguage: string
  status: string
}

const STALE_PROCESSING_MINUTES = 5

function buildStaleProcessingError(minutes: number): string {
  return `Task execution timeout: processing status exceeded ${minutes} minutes`
}

export function parseExecutionConcurrency(input: unknown): number {
  const value = typeof input === 'number' ? input : Number.NaN
  if (!Number.isFinite(value)) return 4
  return Math.max(1, Math.min(12, Math.floor(value)))
}

async function reclaimStaleProcessingTasks(
  prisma: PrismaClient,
  input: {
    taskIds?: string[]
    entityType?: string
    targetLanguage?: string
  }
): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000)

  const result = await prisma.translationTask.updateMany({
    where: {
      status: 'processing',
      updatedAt: { lt: staleBefore },
      ...(input.taskIds && input.taskIds.length > 0
        ? { id: { in: input.taskIds } }
        : {}),
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.targetLanguage
        ? { targetLanguage: input.targetLanguage }
        : {}),
    },
    data: {
      status: 'failed',
      error: buildStaleProcessingError(STALE_PROCESSING_MINUTES),
      updatedAt: new Date(),
    },
  })

  return Number(result.count || 0)
}

async function resolveTaskIdsByFilter(
  prisma: PrismaClient,
  input: {
    entityType?: string
    targetLanguage?: string
    q?: string | null
    limit?: number
    includeFailed?: boolean
    statusScope?: TaskStatusScope
  }
): Promise<string[]> {
  if (input.q && input.q.trim()) {
    const status =
      input.statusScope === 'failed'
        ? 'failed'
        : input.statusScope === 'pending_or_failed'
          ? 'all'
          : input.includeFailed
            ? 'all'
            : 'pending'
    const listed = await listTranslationTasksForAdmin({
      status,
      entityType: input.entityType || 'all',
      targetLanguage: input.targetLanguage || 'all',
      q: input.q,
      page: 1,
      pageSize: Math.min(input.limit ?? 300, 1000),
    })
    const pendingStatuses =
      input.statusScope === 'failed'
        ? new Set(['failed'])
        : input.statusScope === 'pending_or_failed' || input.includeFailed
          ? new Set(['pending', 'failed'])
          : new Set(['pending'])

    return listed.tasks
      .filter((task) => pendingStatuses.has(task.status))
      .map((task) => task.id)
  }

  const statusScope =
    input.statusScope ||
    (input.includeFailed ? 'pending_or_failed' : 'pending')
  const statusWhere =
    statusScope === 'pending'
      ? 'pending'
      : statusScope === 'failed'
        ? 'failed'
        : { in: ['pending', 'failed'] }

  const rows = await prisma.translationTask.findMany({
    where: {
      status: statusWhere,
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.targetLanguage
        ? { targetLanguage: input.targetLanguage }
        : {}),
    },
    orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
    take: input.limit ?? 300,
    select: { id: true },
  })

  return rows.map((row) => row.id)
}

async function executeNonMapTask(
  prisma: PrismaClient,
  task: TaskRow
): Promise<ExecuteTranslationTaskResult> {
  try {
    let result
    if (task.entityType === 'article') {
      result = await translateArticle(task.entityId, task.targetLanguage)
    } else if (task.entityType === 'city') {
      result = await translateCity(task.entityId, task.targetLanguage)
    } else if (task.entityType === 'anime') {
      result = await translateAnime(task.entityId, task.targetLanguage)
    } else {
      result = { success: false, error: 'Unknown entity type' as string }
    }

    if (result.success) {
      await prisma.translationTask.update({
        where: { id: task.id },
        data: {
          status: 'ready',
          sourceHash: result.sourceHash || null,
          sourceContent: result.sourceContent as any,
          draftContent: result.translatedContent as any,
          error: null,
          updatedAt: new Date(),
        } as any,
      })
      return { taskId: task.id, status: 'ready' }
    }

    const error = result.error || 'Translation failed'
    await prisma.translationTask.update({
      where: { id: task.id },
      data: {
        status: 'failed',
        error,
        updatedAt: new Date(),
      },
    })
    return { taskId: task.id, status: 'failed', error }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error'
    try {
      await prisma.translationTask.update({
        where: { id: task.id },
        data: {
          status: 'failed',
          error: message,
          updatedAt: new Date(),
        },
      })
    } catch (updateError) {
      console.error(
        '[translation/adminExecution] failed to update task status',
        updateError
      )
    }

    return { taskId: task.id, status: 'failed', error: message }
  }
}

export async function executeTranslationTasks(
  prisma: PrismaClient,
  input: ExecuteTranslationTasksInput
): Promise<ExecuteTranslationTasksResult> {
  const concurrency = parseExecutionConcurrency(input.concurrency)
  const rawTaskIds =
    input.taskIds && input.taskIds.length > 0
      ? Array.from(
          new Set(input.taskIds.map((taskId) => String(taskId).trim()).filter(Boolean))
        )
      : await resolveTaskIdsByFilter(prisma, input)

  const reclaimedProcessing = await reclaimStaleProcessingTasks(prisma, {
    taskIds: rawTaskIds.length > 0 ? rawTaskIds : undefined,
    entityType: input.entityType,
    targetLanguage: input.targetLanguage,
  })

  if (rawTaskIds.length === 0) {
    return {
      reclaimedProcessing,
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      results: [],
    }
  }

  const tasks = await prisma.translationTask.findMany({
    where: { id: { in: rawTaskIds } },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      targetLanguage: true,
      status: true,
    },
  })

  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const resultById = new Map<string, ExecuteTranslationTaskResult>()
  const executableIds: string[] = []

  for (const taskId of rawTaskIds) {
    const task = taskById.get(taskId)
    if (!task) {
      resultById.set(taskId, {
        taskId,
        status: 'skipped',
        error: 'Task not found',
      })
      continue
    }

    if (task.status !== 'pending' && task.status !== 'failed') {
      resultById.set(taskId, {
        taskId,
        status: 'skipped',
        error: `Task status is ${task.status}`,
      })
      continue
    }

    executableIds.push(taskId)
  }

  if (executableIds.length > 0) {
    await prisma.translationTask.updateMany({
      where: {
        id: { in: executableIds },
        status: { in: ['pending', 'failed'] },
      },
      data: {
        status: 'processing',
        error: null,
        updatedAt: new Date(),
      },
    })
  }

  const processingTasks = await prisma.translationTask.findMany({
    where: {
      id: { in: executableIds },
      status: 'processing',
    },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      targetLanguage: true,
      status: true,
    },
  })

  const mapTasks = processingTasks.filter(
    (task) =>
      task.entityType === 'anitabi_bangumi' ||
      task.entityType === 'anitabi_point'
  )
  const nonMapTasks = processingTasks.filter(
    (task) =>
      task.entityType !== 'anitabi_bangumi' &&
      task.entityType !== 'anitabi_point'
  )

  if (mapTasks.length > 0) {
    const mapResults = await executeMapTranslationTasks({
      prisma,
      tasks: mapTasks,
      concurrency,
    })
    for (const row of mapResults) {
      resultById.set(row.taskId, row)
    }
  }

  for (const task of nonMapTasks) {
    const result = await executeNonMapTask(prisma, task)
    resultById.set(result.taskId, result)
  }

  for (const taskId of executableIds) {
    if (!resultById.has(taskId)) {
      resultById.set(taskId, {
        taskId,
        status: 'failed',
        error: 'Task could not be claimed for processing',
      })
    }
  }

  const results = rawTaskIds.map(
    (taskId) =>
      resultById.get(taskId) || {
        taskId,
        status: 'failed' as const,
        error: 'Unknown execution result',
      }
  )

  const success = results.filter((row) => row.status === 'ready').length
  const failed = results.filter((row) => row.status === 'failed').length
  const skipped = results.filter((row) => row.status === 'skipped').length

  return {
    reclaimedProcessing,
    total: rawTaskIds.length,
    processed: success + failed,
    success,
    failed,
    skipped,
    results,
  }
}

async function updateTaskFailed(
  prisma: PrismaClient,
  id: string,
  error: string
) {
  await prisma.translationTask.update({
    where: { id },
    data: {
      status: 'failed',
      error,
      updatedAt: new Date(),
    },
  })
}

export async function translateTranslationTaskById(
  prisma: PrismaClient,
  id: string
): Promise<{ status: 'ready' | 'failed' }> {
  const task = await prisma.translationTask.findUnique({
    where: { id },
  })

  if (!task) {
    const error = new Error('Task not found')
    ;(error as Error & { status?: number }).status = 404
    throw error
  }

  await prisma.translationTask.update({
    where: { id },
    data: {
      status: 'processing',
      updatedAt: new Date(),
    },
  })

  try {
    let result
    if (task.entityType === 'article') {
      result = await translateArticle(task.entityId, task.targetLanguage)
    } else if (task.entityType === 'city') {
      result = await translateCity(task.entityId, task.targetLanguage)
    } else if (task.entityType === 'anime') {
      result = await translateAnime(task.entityId, task.targetLanguage)
    } else if (task.entityType === 'anitabi_bangumi') {
      result = await translateAnitabiBangumi(task.entityId, task.targetLanguage)
    } else if (task.entityType === 'anitabi_point') {
      result = await translateAnitabiPoint(task.entityId, task.targetLanguage)
    } else {
      const error = new Error('Unknown entity type')
      ;(error as Error & { status?: number }).status = 400
      throw error
    }

    if (result.success) {
      await prisma.translationTask.update({
        where: { id },
        data: {
          status: 'ready',
          sourceHash: result.sourceHash || null,
          sourceContent: result.sourceContent as any,
          draftContent: result.translatedContent as any,
          error: null,
          updatedAt: new Date(),
        } as any,
      })
      return { status: 'ready' }
    }

    await updateTaskFailed(prisma, id, result.error || 'Translation failed')
    return { status: 'failed' }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error'
    await updateTaskFailed(prisma, id, message)

    const status = (error as { status?: number } | null)?.status
    if (status === 400) {
      const known = new Error(message)
      ;(known as Error & { status?: number }).status = 400
      throw known
    }

    return { status: 'failed' }
  }
}
