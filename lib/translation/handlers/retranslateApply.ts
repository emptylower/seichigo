import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'

const applySchema = z.object({
  entityType: z.enum([
    'anime',
    'city',
    'article',
    'anitabi_bangumi',
    'anitabi_point',
  ]),
  entityId: z.string().min(1),
  targetLang: z.enum(['en', 'ja']),
  preview: z.record(z.any()),
  translationTaskId: z.string().optional(),
})

function buildTaskDraftContent(
  entityType: 'article' | 'anitabi_bangumi' | 'anitabi_point',
  preview: Record<string, unknown>
) {
  const updateData: Record<string, unknown> = {}

  if (entityType === 'article') {
    if ('title' in preview) updateData.title = preview.title
    if ('description' in preview) updateData.description = preview.description
    if ('seoTitle' in preview) updateData.seoTitle = preview.seoTitle
    if ('contentJson' in preview) {
      updateData.contentJson = preview.contentJson
      updateData.contentHtml = renderArticleContentHtmlFromJson(preview.contentJson)
    }
    return updateData
  }

  if (entityType === 'anitabi_bangumi') {
    if ('title' in preview) updateData.title = preview.title
    if ('description' in preview) updateData.description = preview.description
    if ('city' in preview) updateData.city = preview.city
    return updateData
  }

  if ('name' in preview) updateData.name = preview.name
  if ('note' in preview) updateData.note = preview.note
  return updateData
}

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      const body = await req.json().catch(() => null)
      const parsed = applySchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || 'Invalid parameters' },
          { status: 400 }
        )
      }

      const { entityType, entityId, preview, targetLang, translationTaskId } = parsed.data

      try {
        if (
          entityType === 'article' ||
          entityType === 'anitabi_bangumi' ||
          entityType === 'anitabi_point'
        ) {
          if (!translationTaskId) {
            return NextResponse.json(
              { error: 'translationTaskId is required for this entity type' },
              { status: 400 }
            )
          }

          const draftContent = buildTaskDraftContent(
            entityType,
            preview
          )

          const updated = await deps.prisma.translationTask.update({
            where: { id: translationTaskId },
            data: {
              draftContent: draftContent as any,
              updatedAt: new Date(),
            },
          })

          return NextResponse.json({ ok: true, updated })
        }

        if (entityType === 'city') {
          const updateData: Record<string, unknown> = {}
          if (targetLang === 'en') {
            if ('name' in preview) updateData.name_en = preview.name
            if ('description' in preview) updateData.description_en = preview.description
            if ('transportTips' in preview) updateData.transportTips_en = preview.transportTips
          } else {
            if ('name' in preview) updateData.name_ja = preview.name
            if ('description' in preview) updateData.description_ja = preview.description
            if ('transportTips' in preview) updateData.transportTips_ja = preview.transportTips
          }

          const updated = await deps.prisma.city.update({
            where: { id: entityId },
            data: updateData,
          })

          return NextResponse.json({ ok: true, updated })
        }

        const updateData: Record<string, unknown> = {}
        if (targetLang === 'en') {
          if ('name' in preview) updateData.name_en = preview.name
          if ('summary' in preview) updateData.summary_en = preview.summary
        } else {
          if ('name' in preview) updateData.name_ja = preview.name
          if ('summary' in preview) updateData.summary_ja = preview.summary
        }

        const updated = await deps.prisma.anime.update({
          where: { id: entityId },
          data: updateData,
        })

        return NextResponse.json({ ok: true, updated })
      } catch (error) {
        const message = String((error as { message?: unknown } | null)?.message || '')
        if (message.includes('Record to update not found')) {
          return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
        }
        throw error
      }
    },
  }
}
