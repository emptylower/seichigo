import type { PrismaClient } from '@prisma/client'
import { approveArticleTask } from '@/lib/translation/approval/approveArticle'
import {
  approveAnimeTask,
  approveBangumiTask,
  approveCityTask,
  approvePointTask,
} from '@/lib/translation/approval/approveEntity'
import {
  HttpError,
  type ApproveMutationResult,
  revalidateAnimePaths,
  revalidateArticlePaths,
  revalidateCityPaths,
  revalidateMapPaths,
  resolveTaskSourceHash,
} from '@/lib/translation/approval/shared'
import {
  rollbackArticleTranslationTask,
  updatePublishedTranslationTask,
} from '@/lib/translation/approval/history'

export type ApproveBatchResult = {
  taskId: string
  status: 'approved' | 'skipped' | 'failed'
  error?: string
}

export async function approveTranslationTaskById(
  prisma: PrismaClient,
  id: string
) {
  const task = await prisma.translationTask.findUnique({
    where: { id },
  })

  if (!task) {
    throw new HttpError(404, 'Task not found')
  }

  if (!task.draftContent) {
    throw new HttpError(400, 'No draft content to approve')
  }

  const result: ApproveMutationResult | null =
    task.entityType === 'article'
      ? await approveArticleTask(prisma, task)
      : task.entityType === 'city'
        ? await approveCityTask(prisma, task)
        : task.entityType === 'anime'
          ? await approveAnimeTask(prisma, task)
          : task.entityType === 'anitabi_bangumi'
            ? await approveBangumiTask(prisma, task)
            : task.entityType === 'anitabi_point'
              ? await approvePointTask(prisma, task)
              : null

  if (!result) {
    throw new HttpError(400, 'Unknown entity type')
  }

  await prisma.translationTask.update({
    where: { id },
    data: {
      status: 'approved',
      sourceHash: result.sourceHash,
      finalContent: result.finalContent as any,
      error: null,
      updatedAt: new Date(),
    } as any,
  })

  if (task.entityType === 'article') {
    revalidateArticlePaths(result.revalidateSlug)
  } else if (task.entityType === 'city') {
    revalidateCityPaths(result.revalidateCitySlug)
  } else if (task.entityType === 'anime') {
    revalidateAnimePaths(task.entityId)
  } else if (
    task.entityType === 'anitabi_bangumi' ||
    task.entityType === 'anitabi_point'
  ) {
    revalidateMapPaths()
  }

  return { ok: true }
}

export async function approveBatchMapTranslationTasks(
  prisma: PrismaClient,
  taskIds: string[]
) {
  const dedupedTaskIds = Array.from(
    new Set(taskIds.map((taskId) => String(taskId).trim()).filter(Boolean))
  )
  const tasks = await prisma.translationTask.findMany({
    where: {
      id: { in: dedupedTaskIds },
    },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      targetLanguage: true,
      status: true,
      sourceHash: true,
      sourceContent: true,
      draftContent: true,
    },
  })

  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const results: ApproveBatchResult[] = []

  for (const taskId of dedupedTaskIds) {
    const task = taskById.get(taskId)
    if (!task) {
      results.push({ taskId, status: 'skipped', error: 'Task not found' })
      continue
    }

    if (task.status !== 'ready') {
      results.push({
        taskId,
        status: 'skipped',
        error: `Task status is ${task.status}`,
      })
      continue
    }

    if (
      task.entityType !== 'anitabi_bangumi' &&
      task.entityType !== 'anitabi_point'
    ) {
      results.push({
        taskId,
        status: 'skipped',
        error: `Unsupported entity type ${task.entityType}`,
      })
      continue
    }

    if (!task.draftContent || typeof task.draftContent !== 'object') {
      await prisma.translationTask.update({
        where: { id: taskId },
        data: {
          error: 'No draft content to approve',
          updatedAt: new Date(),
        },
      })
      results.push({
        taskId,
        status: 'failed',
        error: 'No draft content to approve',
      })
      continue
    }

    try {
      if (task.entityType === 'anitabi_bangumi') {
        await approveBangumiTask(prisma, task)
      } else {
        await approvePointTask(prisma, task)
      }

      await prisma.translationTask.update({
        where: { id: taskId },
        data: {
          status: 'approved',
          finalContent: task.draftContent as any,
          sourceHash: resolveTaskSourceHash(task),
          error: null,
          updatedAt: new Date(),
        } as any,
      })

      results.push({ taskId, status: 'approved' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approve failed'
      await prisma.translationTask.update({
        where: { id: taskId },
        data: {
          error: message,
          updatedAt: new Date(),
        },
      })
      results.push({
        taskId,
        status: 'failed',
        error: message,
      })
    }
  }

  revalidateMapPaths()

  return {
    total: dedupedTaskIds.length,
    approved: results.filter((row) => row.status === 'approved').length,
    skipped: results.filter((row) => row.status === 'skipped').length,
    failed: results.filter((row) => row.status === 'failed').length,
    results,
  }
}

export { rollbackArticleTranslationTask, updatePublishedTranslationTask }

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError
}
