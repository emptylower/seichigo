import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { translateAnime, translateCity, translateArticle, translateText, translateTipTapContent } from '@/lib/translation/service'
import { prisma } from '@/lib/db/prisma'
import { z } from 'zod'
import type { TipTapNode } from '@/lib/translation/tiptap'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'

const retranslateSchema = z.object({
  entityType: z.enum(['anime', 'city', 'article', 'text']),
  entityId: z.string().optional(),
  targetLang: z.enum(['en', 'ja']),
  field: z.string().optional(),
  text: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
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

    const { entityType, entityId, targetLang, field, text } = parsed.data

    let result
    if (entityType === 'text') {
      if (!text) {
        return NextResponse.json(
          { error: 'Text is required for text translation' },
          { status: 400 }
        )
      }
      const translatedText = await translateText(text, targetLang)
      return NextResponse.json({
        ok: true,
        preview: translatedText,
        sourceContent: text,
      })
    } else if (entityType === 'article') {
      if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })
      
      // Try to find existing task with sourceContent
      const existingTask = await prisma.translationTask.findFirst({
        where: {
          entityType: 'article',
          entityId,
          targetLanguage: targetLang,
        },
        select: { sourceContent: true },
      })

      if (existingTask?.sourceContent) {
        // Use preserved source content for translation
        const source = existingTask.sourceContent as any
        const translatedTitle = await translateText(source.title, targetLang)
        const translatedDescription = source.description
          ? await translateText(source.description, targetLang)
          : null
        const translatedSeoTitle = source.seoTitle
          ? await translateText(source.seoTitle, targetLang)
          : null
        
        let translatedContentJson = source.contentJson
        if (source.contentJson && typeof source.contentJson === 'object') {
          translatedContentJson = await translateTipTapContent(
            source.contentJson as TipTapNode,
            targetLang
          )
        }
        
        const contentHtml = renderArticleContentHtmlFromJson(translatedContentJson)
        
        result = {
          success: true,
          sourceContent: source,
          translatedContent: {
            title: translatedTitle,
            description: translatedDescription,
            seoTitle: translatedSeoTitle,
            contentJson: translatedContentJson,
            contentHtml,
          },
        }
      } else {
        // Fall back to fetching from article (first-time translation)
        result = await translateArticle(entityId, targetLang)
      }
    } else if (entityType === 'city') {
      if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })
      result = await translateCity(entityId, targetLang)
    } else if (entityType === 'anime') {
      if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })
      result = await translateAnime(entityId, targetLang)
    } else {
      return NextResponse.json(
        { error: 'Unknown entity type' },
        { status: 400 }
      )
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Translation failed' },
        { status: 500 }
      )
    }

    // If field is specified, return only that field
    let preview = result.translatedContent
    if (field && preview && typeof preview === 'object') {
      if (field in preview) {
        preview = { [field]: preview[field as keyof typeof preview] }
      } else {
        return NextResponse.json(
          { error: `Field '${field}' not found in translated content` },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({
      ok: true,
      preview,
      sourceContent: result.sourceContent,
    })
  } catch (error) {
    console.error('[api/admin/retranslate] POST failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
