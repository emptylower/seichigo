import { NextResponse } from 'next/server'
import type { TranslationApiDeps } from '@/lib/translation/api'

export function createHandlers(deps: TranslationApiDeps) {
  return {
    async GET(req: Request) {
      const { searchParams } = new URL(req.url)
      const slug = searchParams.get('slug')
      const currentLang = searchParams.get('currentLang')
      const targetLang = searchParams.get('targetLang')

      if (!slug || !currentLang || !targetLang) {
        return NextResponse.json(
          {
            error:
              'Missing required parameters: slug, currentLang, targetLang',
          },
          { status: 400 }
        )
      }

      const translatedSlug = await deps.getTranslatedArticleSlugBySource(
        deps.prisma,
        {
          slug,
          currentLang,
          targetLang,
        }
      )

      return NextResponse.json({ translatedSlug }, { status: 200 })
    },
  }
}
