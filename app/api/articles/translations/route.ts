import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'

function routeError(err: unknown) {
  const code = (err as any)?.code
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json({ error: 'Database schema not migrated' }, { status: 503 })
  }
  const msg = String((err as any)?.message || '')
  if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }
  return NextResponse.json({ error: 'Server error' }, { status: 500 })
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const slug = searchParams.get('slug')
    const currentLang = searchParams.get('currentLang')
    const targetLang = searchParams.get('targetLang')

    if (!slug || !currentLang || !targetLang) {
      return NextResponse.json(
        { error: 'Missing required parameters: slug, currentLang, targetLang' },
        { status: 400 }
      )
    }

    const sourceArticle = await prisma.article.findUnique({
      where: { slug_language: { slug, language: currentLang } },
      select: {
        id: true,
        slug: true,
        language: true,
        translationGroupId: true,
      },
    })

    if (!sourceArticle) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 })
    }

    if (!sourceArticle.translationGroupId) {
      return NextResponse.json({ translatedSlug: null }, { status: 200 })
    }

    const translation = await prisma.article.findFirst({
      where: {
        translationGroupId: sourceArticle.translationGroupId,
        language: targetLang,
        status: 'published',
      },
      select: {
        slug: true,
        language: true,
      },
    })

    if (!translation) {
      return NextResponse.json({ translatedSlug: null }, { status: 200 })
    }

    return NextResponse.json({ translatedSlug: translation.slug }, { status: 200 })
  } catch (err) {
    console.error('[api/articles/translations] GET failed', err)
    return routeError(err)
  }
}
