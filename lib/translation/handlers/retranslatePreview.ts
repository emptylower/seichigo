import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { TranslationApiDeps } from '@/lib/translation/api'
import { isAdminSession } from '@/lib/translation/handlers/common'
import {
  translateAnime,
  translateAnitabiBangumi,
  translateAnitabiPoint,
  translateArticle,
  translateCity,
  translateText,
  translateTipTapContent,
} from '@/lib/translation/service'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'

const retranslateSchema = z.object({
  entityType: z.enum([
    'anime',
    'city',
    'article',
    'anitabi_bangumi',
    'anitabi_point',
    'text',
  ]),
  entityId: z.string().optional(),
  targetLang: z.enum(['en', 'ja']),
  field: z.string().optional(),
  text: z.string().optional(),
})

type PreviewResponse = {
  preview: unknown
  sourceContent?: unknown
}

async function previewArticleFromExistingTask(
  prisma: TranslationApiDeps['prisma'],
  entityId: string,
  targetLang: 'en' | 'ja'
): Promise<PreviewResponse | null> {
  let existingTask: { sourceContent: unknown } | null = null
  try {
    existingTask = await prisma.translationTask.findFirst({
      where: {
        entityType: 'article',
        entityId,
        targetLanguage: targetLang,
      },
      select: { sourceContent: true },
    })
  } catch {
    existingTask = null
  }

  if (!existingTask?.sourceContent || typeof existingTask.sourceContent !== 'object') {
    return null
  }

  const source = existingTask.sourceContent as {
    title?: string
    description?: string | null
    seoTitle?: string | null
    contentJson?: unknown
  }

  const translatedTitle = await translateText(source.title || '', targetLang)
  const translatedDescription = source.description
    ? await translateText(source.description, targetLang)
    : null
  const translatedSeoTitle = source.seoTitle
    ? await translateText(source.seoTitle, targetLang)
    : null

  let translatedContentJson = source.contentJson ?? null
  if (source.contentJson && typeof source.contentJson === 'object') {
    translatedContentJson = await translateTipTapContent(
      source.contentJson as Parameters<typeof translateTipTapContent>[0],
      targetLang
    )
  }

  return {
    sourceContent: source,
    preview: {
      title: translatedTitle,
      description: translatedDescription,
      seoTitle: translatedSeoTitle,
      contentJson: translatedContentJson,
      contentHtml: renderArticleContentHtmlFromJson(translatedContentJson),
    },
  }
}

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      const body = await req.json().catch(() => null)
      const parsed = retranslateSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || 'Invalid parameters' },
          { status: 400 }
        )
      }

      const { entityType, entityId, field, targetLang, text } = parsed.data

      if (entityType === 'text') {
        if (!text) {
          return NextResponse.json(
            { error: 'Text is required for text translation' },
            { status: 400 }
          )
        }

        const preview = await translateText(text, targetLang)
        return NextResponse.json({
          ok: true,
          preview,
          sourceContent: text,
        })
      }

      if (!entityId) {
        return NextResponse.json({ error: 'entityId required' }, { status: 400 })
      }

      const fallbackPreview =
        entityType === 'article'
          ? await previewArticleFromExistingTask(deps.prisma, entityId, targetLang)
          : null

      const result = fallbackPreview
        ? {
            success: true as const,
            sourceContent: fallbackPreview.sourceContent,
            translatedContent: fallbackPreview.preview,
          }
        : entityType === 'article'
          ? await translateArticle(entityId, targetLang)
          : entityType === 'city'
            ? await translateCity(entityId, targetLang)
            : entityType === 'anime'
              ? await translateAnime(entityId, targetLang)
              : entityType === 'anitabi_bangumi'
                ? await translateAnitabiBangumi(entityId, targetLang)
                : await translateAnitabiPoint(entityId, targetLang)

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Translation failed' },
          { status: 500 }
        )
      }

      let preview: unknown = result.translatedContent
      if (field && preview && typeof preview === 'object') {
        const candidate = preview as Record<string, unknown>
        if (!(field in candidate)) {
          return NextResponse.json(
            { error: `Field '${field}' not found in translated content` },
            { status: 400 }
          )
        }
        preview = { [field]: candidate[field] }
      }

      return NextResponse.json({
        ok: true,
        preview,
        sourceContent: result.sourceContent,
      })
    },
  }
}
