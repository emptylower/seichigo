import type { PrismaClient } from '@prisma/client'
import { getArticleCityIds, setArticleCityIds } from '@/lib/city/links'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'
import { safeRevalidatePath } from '@/lib/next/revalidate'
import {
  buildBangumiSourceHash,
  buildPointSourceHash,
} from '@/lib/translation/mapSourceHash'

export type ApproveBatchResult = {
  taskId: string
  status: 'approved' | 'skipped' | 'failed'
  error?: string
}

class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function normalizeArticleDraftContent(
  draftContent: unknown
): Record<string, unknown> {
  const draftData =
    draftContent && typeof draftContent === 'object'
      ? { ...(draftContent as Record<string, unknown>) }
      : {}
  const contentJson = draftData.contentJson
  if (contentJson && typeof contentJson === 'object') {
    draftData.contentHtml = renderArticleContentHtmlFromJson(contentJson)
  }
  return draftData
}

function isEmptyDocContentJson(contentJson: unknown): boolean {
  if (!contentJson || typeof contentJson !== 'object') return true
  const doc = contentJson as { content?: unknown }
  return !Array.isArray(doc.content) || doc.content.length === 0
}

function revalidateArticlePaths(slug: string | null | undefined) {
  safeRevalidatePath('/')
  safeRevalidatePath('/en')
  safeRevalidatePath('/ja')
  if (!slug) return
  safeRevalidatePath(`/posts/${slug}`)
  safeRevalidatePath(`/en/posts/${slug}`)
  safeRevalidatePath(`/ja/posts/${slug}`)
}

function revalidateCityPaths(slug: string | null | undefined) {
  safeRevalidatePath('/city')
  safeRevalidatePath('/en/city')
  if (!slug) return
  const encoded = encodeURIComponent(slug)
  safeRevalidatePath(`/city/${encoded}`)
  safeRevalidatePath(`/en/city/${encoded}`)
}

function revalidateAnimePaths(id: string) {
  const encoded = encodeURIComponent(id)
  safeRevalidatePath('/anime')
  safeRevalidatePath('/ja/anime')
  safeRevalidatePath('/en/anime')
  safeRevalidatePath(`/anime/${encoded}`)
  safeRevalidatePath(`/ja/anime/${encoded}`)
  safeRevalidatePath(`/en/anime/${encoded}`)
}

function revalidateMapPaths() {
  safeRevalidatePath('/map')
  safeRevalidatePath('/en/map')
  safeRevalidatePath('/ja/map')
}

function resolveTaskSourceHash(task: {
  entityType: string
  sourceHash: string | null
  sourceContent: unknown
  draftContent: unknown
}): string | null {
  if (task.sourceHash) return task.sourceHash

  if (task.entityType === 'anitabi_bangumi') {
    const source = task.sourceContent as
      | {
          title?: string
          description?: string | null
          city?: string | null
        }
      | null
    const draft = task.draftContent as
      | {
          title?: string
          description?: string | null
          city?: string | null
        }
      | null
    return buildBangumiSourceHash({
      titleZh: source?.title || draft?.title || '',
      description: source?.description || draft?.description || null,
      city: source?.city || draft?.city || null,
    })
  }

  if (task.entityType === 'anitabi_point') {
    const source = task.sourceContent as
      | {
          name?: string
          note?: string | null
        }
      | null
    const draft = task.draftContent as
      | {
          name?: string
          note?: string | null
        }
      | null
    return buildPointSourceHash({
      name: source?.name || draft?.name || '',
      nameZh: source?.name || draft?.name || '',
      mark: source?.note || draft?.note || null,
    })
  }

  return null
}

async function approveArticleTask(
  prisma: PrismaClient,
  task: {
    id: string
    entityId: string
    targetLanguage: string
    draftContent: unknown
  }
) {
  const draftData = normalizeArticleDraftContent(task.draftContent)
  let revalidateSlug: string | null = null

  const existingArticle = await prisma.article.findFirst({
    where: {
      translationGroupId: task.entityId,
      language: task.targetLanguage,
    },
  })

  if (existingArticle) {
    await prisma.article.update({
      where: { id: existingArticle.id },
      data: draftData as any,
    })

    try {
      const sourceCityIds = await getArticleCityIds(task.entityId)
      await setArticleCityIds(existingArticle.id, sourceCityIds)
    } catch (error) {
      console.error(
        '[translation/adminApproval] city link sync failed',
        error
      )
    }

    revalidateSlug = existingArticle.slug || null
    return { finalContent: draftData, sourceHash: null, revalidateSlug }
  }

  const sourceArticle = await prisma.article.findUnique({
    where: { id: task.entityId },
    select: {
      id: true,
      authorId: true,
      slug: true,
      translationGroupId: true,
      cover: true,
      animeIds: true,
      city: true,
      routeLength: true,
      tags: true,
    },
  })

  if (!sourceArticle) {
    throw new HttpError(404, 'Source article not found')
  }

  const newArticle = await prisma.article.create({
    data: {
      ...draftData,
      slug: draftData.slug || sourceArticle.slug,
      authorId: sourceArticle.authorId,
      language: task.targetLanguage,
      translationGroupId: sourceArticle.translationGroupId || sourceArticle.id,
      cover: sourceArticle.cover,
      animeIds: sourceArticle.animeIds,
      city: sourceArticle.city,
      routeLength: sourceArticle.routeLength,
      tags: sourceArticle.tags,
      status: 'published',
    } as any,
  })

  try {
    const createdArticleId = String((newArticle as { id?: unknown } | null)?.id || '')
    const sourceCityIds = await getArticleCityIds(sourceArticle.id)
    if (createdArticleId && sourceCityIds.length > 0) {
      await setArticleCityIds(createdArticleId, sourceCityIds)
    }
  } catch (error) {
    console.error('[translation/adminApproval] city link sync failed', error)
  }

  if (!sourceArticle.translationGroupId) {
    await prisma.article.update({
      where: { id: sourceArticle.id },
      data: { translationGroupId: sourceArticle.id },
    })
  }

  return {
    finalContent: draftData,
    sourceHash: null,
    revalidateSlug: String(
      (newArticle as { slug?: unknown } | null)?.slug
      || draftData.slug
      || sourceArticle.slug
      || ''
    ) || null,
  }
}

async function approveCityTask(
  prisma: PrismaClient,
  task: {
    entityId: string
    targetLanguage: string
    draftContent: unknown
  }
) {
  const content = (task.draftContent || {}) as {
    name?: string
    description?: string
    transportTips?: string
  }
  const updateData: Record<string, unknown> = {}

  if (task.targetLanguage === 'en') {
    if (content.name) updateData.name_en = content.name
    if (content.description) updateData.description_en = content.description
    if (content.transportTips) updateData.transportTips_en = content.transportTips
  } else if (task.targetLanguage === 'ja') {
    if (content.name) updateData.name_ja = content.name
    if (content.description) updateData.description_ja = content.description
    if (content.transportTips) updateData.transportTips_ja = content.transportTips
  }

  await prisma.city.update({
    where: { id: task.entityId },
    data: updateData,
  })

  const city = await prisma.city.findUnique({
    where: { id: task.entityId },
    select: { slug: true },
  })

  return {
    finalContent: task.draftContent,
    sourceHash: null,
    revalidateCitySlug: city?.slug || null,
  }
}

async function approveAnimeTask(
  prisma: PrismaClient,
  task: {
    entityId: string
    targetLanguage: string
    draftContent: unknown
  }
) {
  const content = (task.draftContent || {}) as {
    name?: string
    summary?: string
  }
  const updateData: Record<string, unknown> = {}

  if (task.targetLanguage === 'en') {
    if (content.name) updateData.name_en = content.name
    if (content.summary) updateData.summary_en = content.summary
  } else if (task.targetLanguage === 'ja') {
    if (content.name) updateData.name_ja = content.name
    if (content.summary) updateData.summary_ja = content.summary
  }

  await prisma.anime.update({
    where: { id: task.entityId },
    data: updateData,
  })

  return {
    finalContent: task.draftContent,
    sourceHash: null,
  }
}

async function approveBangumiTask(
  prisma: PrismaClient,
  task: {
    entityId: string
    targetLanguage: string
    sourceHash: string | null
    sourceContent: unknown
    draftContent: unknown
  }
) {
  const bangumiId = Number.parseInt(String(task.entityId), 10)
  if (!Number.isFinite(bangumiId)) {
    throw new HttpError(400, 'Invalid bangumi id')
  }

  const content = (task.draftContent || {}) as {
    title?: string | null
    description?: string | null
    city?: string | null
  }
  const source = (task.sourceContent || {}) as {
    title?: string | null
    description?: string | null
    city?: string | null
  }
  const sourceHash =
    task.sourceHash ||
    buildBangumiSourceHash({
      titleZh: source.title ?? content.title ?? '',
      description: source.description ?? content.description ?? null,
      city: source.city ?? content.city ?? null,
    })

  await prisma.anitabiBangumiI18n.upsert({
    where: {
      bangumiId_language: {
        bangumiId,
        language: task.targetLanguage,
      },
    },
    create: {
      bangumiId,
      language: task.targetLanguage,
      sourceHash,
      title: content.title ?? null,
      description: content.description ?? null,
      city: content.city ?? null,
    } as any,
    update: {
      sourceHash,
      title: content.title ?? null,
      description: content.description ?? null,
      city: content.city ?? null,
    } as any,
  })

  return {
    finalContent: task.draftContent,
    sourceHash,
  }
}

async function approvePointTask(
  prisma: PrismaClient,
  task: {
    entityId: string
    targetLanguage: string
    sourceHash: string | null
    sourceContent: unknown
    draftContent: unknown
  }
) {
  const content = (task.draftContent || {}) as {
    name?: string | null
    note?: string | null
  }
  const source = (task.sourceContent || {}) as {
    name?: string | null
    note?: string | null
  }
  const sourceHash =
    task.sourceHash ||
    buildPointSourceHash({
      name: source.name ?? content.name ?? '',
      nameZh: source.name ?? content.name ?? '',
      mark: source.note ?? content.note ?? null,
    })

  await prisma.anitabiPointI18n.upsert({
    where: {
      pointId_language: {
        pointId: task.entityId,
        language: task.targetLanguage,
      },
    },
    create: {
      pointId: task.entityId,
      language: task.targetLanguage,
      sourceHash,
      name: content.name ?? null,
      note: content.note ?? null,
    } as any,
    update: {
      sourceHash,
      name: content.name ?? null,
      note: content.note ?? null,
    } as any,
  })

  return {
    finalContent: task.draftContent,
    sourceHash,
  }
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

  let result:
    | {
        finalContent: unknown
        sourceHash: string | null
        revalidateSlug?: string | null
        revalidateCitySlug?: string | null
      }
    | null = null

  if (task.entityType === 'article') {
    result = await approveArticleTask(prisma, task)
  } else if (task.entityType === 'city') {
    result = await approveCityTask(prisma, task)
  } else if (task.entityType === 'anime') {
    result = await approveAnimeTask(prisma, task)
  } else if (task.entityType === 'anitabi_bangumi') {
    result = await approveBangumiTask(prisma, task)
  } else if (task.entityType === 'anitabi_point') {
    result = await approvePointTask(prisma, task)
  } else {
    throw new HttpError(400, 'Unknown entity type')
  }

  if (!result) {
    throw new HttpError(500, 'Approve workflow returned no result')
  }

  await prisma.translationTask.update({
    where: { id },
    data: {
      status: 'approved',
      sourceHash: result.sourceHash,
      finalContent: result.finalContent as any,
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
          updatedAt: new Date(),
        } as any,
      })

      results.push({ taskId, status: 'approved' })
    } catch (error) {
      results.push({
        taskId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Approve failed',
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

export async function rollbackArticleTranslationTask(
  prisma: PrismaClient,
  input: {
    id: string
    historyId: string
    adminUserId: string
  }
) {
  const result = await prisma.$transaction(async (tx) => {
    const task = await tx.translationTask.findUnique({
      where: { id: input.id },
    })
    if (!task) throw new HttpError(404, 'Task not found')
    if (task.entityType !== 'article') {
      throw new HttpError(400, 'Unsupported translation entity type')
    }

    const targetHistory = await tx.translationHistory.findUnique({
      where: { id: input.historyId },
    })

    if (!targetHistory || targetHistory.translationTaskId !== task.id) {
      throw new HttpError(404, 'History not found')
    }

    const currentArticle = await tx.article.findFirst({
      where: {
        translationGroupId: task.entityId,
        language: task.targetLanguage,
      },
      select: {
        id: true,
        title: true,
        description: true,
        contentJson: true,
        contentHtml: true,
        slug: true,
      },
    })

    if (!currentArticle) {
      throw new HttpError(404, 'Published article not found')
    }

    const historyContent = (targetHistory as any).content
    const rollbackContentJson = historyContent?.contentJson
    if (isEmptyDocContentJson(rollbackContentJson)) {
      throw new HttpError(400, 'contentJson is empty')
    }

    const rollbackContentHtmlRaw = historyContent?.contentHtml
    const rollbackContentHtml =
      typeof rollbackContentHtmlRaw === 'string' && rollbackContentHtmlRaw.trim()
        ? rollbackContentHtmlRaw
        : renderArticleContentHtmlFromJson(rollbackContentJson)

    await tx.translationHistory.create({
      data: {
        translationTaskId: task.id,
        articleId: currentArticle.id,
        createdById: input.adminUserId,
        content: {
          title: currentArticle.title,
          description: currentArticle.description,
          contentJson: currentArticle.contentJson,
          contentHtml: currentArticle.contentHtml,
        },
      },
    })

    await tx.article.update({
      where: { id: currentArticle.id },
      data: {
        title: historyContent?.title,
        description: historyContent?.description,
        contentJson: rollbackContentJson,
        contentHtml: rollbackContentHtml,
      } as any,
    })

    await tx.translationTask.update({
      where: { id: task.id },
      data: {
        finalContent: historyContent as any,
        updatedAt: new Date(),
      } as any,
    })

    return { slug: currentArticle.slug }
  })

  revalidateArticlePaths(result.slug)
}

export async function updatePublishedTranslationTask(
  prisma: PrismaClient,
  input: {
    id: string
    articleUpdatedAt: Date
    adminUserId: string
  }
) {
  const task = await prisma.translationTask.findUnique({
    where: { id: input.id },
  })

  if (!task) {
    throw new HttpError(404, 'Task not found')
  }

  if (task.entityType !== 'article') {
    throw new HttpError(400, 'Unsupported translation entity type')
  }

  if (!task.draftContent) {
    throw new HttpError(400, 'No draft content to publish')
  }

  const draft = task.draftContent as Record<string, unknown>
  const contentJson = draft.contentJson
  if (isEmptyDocContentJson(contentJson)) {
    throw new HttpError(400, 'contentJson is empty')
  }

  const publishedArticle = await prisma.article.findFirst({
    where: {
      translationGroupId: task.entityId,
      language: task.targetLanguage,
    },
    select: {
      id: true,
      title: true,
      description: true,
      contentJson: true,
      contentHtml: true,
      slug: true,
      updatedAt: true,
    },
  })

  if (!publishedArticle) {
    throw new HttpError(404, 'Published article not found')
  }

  if (
    publishedArticle.updatedAt.getTime() !== input.articleUpdatedAt.getTime()
  ) {
    throw new HttpError(409, 'Conflict')
  }

  const nextContentHtml = renderArticleContentHtmlFromJson(contentJson)
  const updateData: Record<string, unknown> = {
    ...draft,
    contentJson,
    contentHtml: nextContentHtml,
  }

  await prisma.$transaction(async (tx: any) => {
    await tx.translationHistory.create({
      data: {
        translationTaskId: task.id,
        articleId: publishedArticle.id,
        createdById: input.adminUserId,
        content: {
          title: publishedArticle.title,
          description: publishedArticle.description,
          contentJson: publishedArticle.contentJson,
          contentHtml: publishedArticle.contentHtml,
        },
      },
    })

    await tx.article.update({
      where: { id: publishedArticle.id },
      data: updateData as any,
    })

    await tx.translationTask.update({
      where: { id: task.id },
      data: {
        finalContent: updateData as any,
        updatedAt: new Date(),
      } as any,
    })
  })

  revalidateArticlePaths(publishedArticle.slug)
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError
}
