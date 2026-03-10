import type { PrismaClient } from '@prisma/client'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'
import {
  HttpError,
  isEmptyDocContentJson,
  revalidateArticlePaths,
} from './shared'

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

  if (publishedArticle.updatedAt.getTime() !== input.articleUpdatedAt.getTime()) {
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
