import type { PrismaClient } from '@prisma/client'
import {
  buildBangumiSourceHash,
  buildPointSourceHash,
} from '@/lib/translation/mapSourceHash'
import { HttpError } from './shared'

export async function approveCityTask(
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

export async function approveAnimeTask(
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

export async function approveBangumiTask(
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

export async function approvePointTask(
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
