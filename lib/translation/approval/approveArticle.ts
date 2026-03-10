import type { PrismaClient } from '@prisma/client'
import { getArticleCityIds, setArticleCityIds } from '@/lib/city/links'
import { HttpError, normalizeArticleDraftContent } from './shared'

export async function approveArticleTask(
  prisma: PrismaClient,
  task: {
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
      console.error('[translation/adminApproval] city link sync failed', error)
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
    const createdArticleId = String(
      (newArticle as { id?: unknown } | null)?.id || ''
    )
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
    revalidateSlug:
      String(
        (newArticle as { slug?: unknown } | null)?.slug ||
          draftData.slug ||
          sourceArticle.slug ||
          ''
      ) || null,
  }
}
