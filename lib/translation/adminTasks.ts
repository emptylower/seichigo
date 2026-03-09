import type { PrismaClient } from '@prisma/client'

export async function getTranslationTaskDetail(
  prisma: PrismaClient,
  id: string
) {
  const task = await prisma.translationTask.findUnique({
    where: { id },
  })

  if (!task) return null

  let relatedArticle = null
  let translatedArticle = null
  let relatedEntity = null
  let translatedEntity = null

  if (task.entityType === 'article') {
    relatedArticle = await prisma.article.findUnique({
      where: { id: task.entityId },
      select: {
        updatedAt: true,
        contentJson: true,
      },
    })

    if (task.status === 'approved') {
      translatedArticle = await prisma.article.findFirst({
        where: {
          translationGroupId: task.entityId,
          language: task.targetLanguage,
        },
        select: {
          id: true,
          title: true,
          description: true,
          seoTitle: true,
          contentJson: true,
          updatedAt: true,
        },
      })
    }
  } else if (task.entityType === 'anitabi_bangumi') {
    const bangumiId = Number.parseInt(task.entityId, 10)
    if (Number.isFinite(bangumiId)) {
      relatedEntity = await prisma.anitabiBangumi.findUnique({
        where: { id: bangumiId },
        select: {
          id: true,
          titleZh: true,
          titleJaRaw: true,
          description: true,
          city: true,
          updatedAt: true,
        },
      })
      translatedEntity = await prisma.anitabiBangumiI18n.findUnique({
        where: {
          bangumiId_language: {
            bangumiId,
            language: task.targetLanguage,
          },
        },
        select: {
          title: true,
          description: true,
          city: true,
          updatedAt: true,
        },
      })
    }
  } else if (task.entityType === 'anitabi_point') {
    relatedEntity = await prisma.anitabiPoint.findUnique({
      where: { id: task.entityId },
      select: {
        id: true,
        name: true,
        nameZh: true,
        mark: true,
        updatedAt: true,
      },
    })
    translatedEntity = await prisma.anitabiPointI18n.findUnique({
      where: {
        pointId_language: {
          pointId: task.entityId,
          language: task.targetLanguage,
        },
      },
      select: {
        name: true,
        note: true,
        updatedAt: true,
      },
    })
  }

  return {
    task,
    relatedArticle,
    translatedArticle,
    relatedEntity,
    translatedEntity,
  }
}

export async function updateTranslationTaskDraft(
  prisma: PrismaClient,
  id: string,
  draftContent: unknown
) {
  return prisma.translationTask.update({
    where: { id },
    data: {
      draftContent: draftContent as any,
      updatedAt: new Date(),
    },
  })
}

export async function deleteTranslationTask(
  prisma: PrismaClient,
  id: string
) {
  await prisma.translationTask.delete({
    where: { id },
  })
}

export async function getTranslationTaskHistory(
  prisma: PrismaClient,
  id: string
) {
  return prisma.translationHistory.findMany({
    where: { translationTaskId: id },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  })
}

export async function getTranslatedArticleSlugBySource(
  prisma: PrismaClient,
  input: {
    slug: string
    currentLang: string
    targetLang: string
  }
): Promise<string | null> {
  const sourceArticle = await prisma.article.findUnique({
    where: {
      slug_language: {
        slug: input.slug,
        language: input.currentLang,
      },
    },
    select: {
      id: true,
      translationGroupId: true,
    },
  })

  if (!sourceArticle?.translationGroupId) {
    return null
  }

  const translation = await prisma.article.findFirst({
    where: {
      translationGroupId: sourceArticle.translationGroupId,
      language: input.targetLang,
      status: 'published',
    },
    select: {
      slug: true,
    },
  })

  return translation?.slug || null
}
