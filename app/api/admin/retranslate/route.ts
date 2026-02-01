import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { translateAnime, translateCity, translateArticle } from '@/lib/translation/service'
import { z } from 'zod'

const retranslateSchema = z.object({
  entityType: z.enum(['anime', 'city', 'article']),
  entityId: z.string().min(1),
  targetLang: z.enum(['en', 'ja']),
  field: z.string().optional(),
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

    const { entityType, entityId, targetLang, field } = parsed.data

    let result
    if (entityType === 'article') {
      result = await translateArticle(entityId, targetLang)
    } else if (entityType === 'city') {
      result = await translateCity(entityId, targetLang)
    } else if (entityType === 'anime') {
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
