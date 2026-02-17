export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { executeMapTranslationTasks } from '@/lib/translation/mapTaskExecutor'
import {
  translateAnime,
  translateArticle,
  translateCity,
} from '@/lib/translation/service'

const executeByIdsSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(200),
  concurrency: z.number().int().min(1).max(12).optional(),
})

const executeByFilterSchema = z.object({
  entityType: z.enum(['article', 'city', 'anime', 'anitabi_bangumi', 'anitabi_point']).optional(),
  targetLanguage: z.enum(['en', 'ja']).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  includeFailed: z.boolean().optional(),
  statusScope: z.enum(['pending', 'failed', 'pending_or_failed']).optional(),
  concurrency: z.number().int().min(1).max(12).optional(),
})

type ExecuteResult = {
  taskId: string
  status: 'ready' | 'failed' | 'skipped'
  error?: string
}

type TaskRow = {
  id: string
  entityType: string
  entityId: string
  targetLanguage: string
  status: string
}

const STALE_PROCESSING_MINUTES = 5
type TaskStatusScope = 'pending' | 'failed' | 'pending_or_failed'

function parseConcurrency(input: unknown): number {
  const n = typeof input === 'number' ? input : Number.NaN
  if (!Number.isFinite(n)) return 4
  return Math.max(1, Math.min(12, Math.floor(n)))
}

function buildStaleProcessingError(minutes: number): string {
  return `Task execution timeout: processing status exceeded ${minutes} minutes`
}

async function reclaimStaleProcessingTasks(input: {
  taskIds?: string[]
  entityType?: string
  targetLanguage?: string
}): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000)
  const now = new Date()

  const result = await prisma.translationTask.updateMany({
    where: {
      status: 'processing',
      updatedAt: { lt: staleBefore },
      ...(input.taskIds && input.taskIds.length > 0 ? { id: { in: input.taskIds } } : {}),
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.targetLanguage ? { targetLanguage: input.targetLanguage } : {}),
    },
    data: {
      status: 'failed',
      error: buildStaleProcessingError(STALE_PROCESSING_MINUTES),
      updatedAt: now,
    },
  })

  return Number(result.count || 0)
}

async function resolveTaskIdsByFilter(input: {
  entityType?: string
  targetLanguage?: string
  limit?: number
  includeFailed?: boolean
  statusScope?: TaskStatusScope
}): Promise<string[]> {
  const statusScope = input.statusScope || (input.includeFailed ? 'pending_or_failed' : 'pending')
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
      ...(input.targetLanguage ? { targetLanguage: input.targetLanguage } : {}),
    },
    orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
    take: input.limit ?? 300,
    select: { id: true },
  })

  return rows.map((row) => row.id)
}

async function executeNonMapTask(task: TaskRow): Promise<ExecuteResult> {
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
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    try {
      await prisma.translationTask.update({
        where: { id: task.id },
        data: {
          status: 'failed',
          error: errorMsg,
          updatedAt: new Date(),
        },
      })
    } catch (updateError) {
      console.error('[api/admin/translations/execute] failed to update task status', updateError)
    }

    return { taskId: task.id, status: 'failed', error: errorMsg }
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    let taskIds: string[] = []
    let concurrency = parseConcurrency((body as any)?.concurrency)
    let filterEntityType: string | undefined
    let filterTargetLanguage: string | undefined
    let reclaimedProcessing = 0

    if (body && typeof body === 'object' && Array.isArray((body as any).taskIds)) {
      const parsed = executeByIdsSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || '参数错误' },
          { status: 400 }
        )
      }

      taskIds = Array.from(new Set(parsed.data.taskIds.map((id) => String(id).trim()).filter(Boolean)))
      concurrency = parseConcurrency(parsed.data.concurrency)
      reclaimedProcessing = await reclaimStaleProcessingTasks({
        taskIds: taskIds.length > 0 ? taskIds : undefined,
      })
    } else {
      const parsed = executeByFilterSchema.safeParse(body || {})
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || '参数错误' },
          { status: 400 }
        )
      }

      filterEntityType = parsed.data.entityType
      filterTargetLanguage = parsed.data.targetLanguage
      reclaimedProcessing = await reclaimStaleProcessingTasks({
        entityType: filterEntityType,
        targetLanguage: filterTargetLanguage,
      })
      taskIds = await resolveTaskIdsByFilter({
        entityType: filterEntityType,
        targetLanguage: filterTargetLanguage,
        limit: parsed.data.limit,
        includeFailed: parsed.data.includeFailed,
        statusScope: parsed.data.statusScope,
      })
      concurrency = parseConcurrency(parsed.data.concurrency)
    }

    if (!taskIds.length) {
      return NextResponse.json({
        ok: true,
        reclaimedProcessing,
        total: 0,
        processed: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        results: [],
      })
    }

    const tasks = await prisma.translationTask.findMany({
      where: { id: { in: taskIds } },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        targetLanguage: true,
        status: true,
      },
    })

    const taskById = new Map(tasks.map((task) => [task.id, task]))
    const resultById = new Map<string, ExecuteResult>()
    const executableIds: string[] = []

    for (const taskId of taskIds) {
      const task = taskById.get(taskId)
      if (!task) {
        resultById.set(taskId, { taskId, status: 'skipped', error: 'Task not found' })
        continue
      }

      if (task.status !== 'pending' && task.status !== 'failed') {
        resultById.set(taskId, { taskId, status: 'skipped', error: `Task status is ${task.status}` })
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
      (task) => task.entityType === 'anitabi_bangumi' || task.entityType === 'anitabi_point'
    )

    const nonMapTasks = processingTasks.filter(
      (task) => task.entityType !== 'anitabi_bangumi' && task.entityType !== 'anitabi_point'
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
      const result = await executeNonMapTask(task)
      resultById.set(result.taskId, result)
    }

    for (const taskId of executableIds) {
      if (resultById.has(taskId)) continue
      resultById.set(taskId, { taskId, status: 'failed', error: 'Task could not be claimed for processing' })
    }

    const results = taskIds.map((taskId) => resultById.get(taskId) || {
      taskId,
      status: 'failed' as const,
      error: 'Unknown execution result',
    })

    const success = results.filter((result) => result.status === 'ready').length
    const failed = results.filter((result) => result.status === 'failed').length
    const skipped = results.filter((result) => result.status === 'skipped').length

    return NextResponse.json({
      ok: true,
      reclaimedProcessing,
      total: taskIds.length,
      processed: success + failed,
      success,
      failed,
      skipped,
      results,
    })
  } catch (error) {
    console.error('[api/admin/translations/execute] POST failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
