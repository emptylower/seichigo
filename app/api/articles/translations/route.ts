import { NextResponse } from 'next/server'
import { getTranslationApiDeps } from '@/lib/translation/api'
import { routeError } from '@/lib/translation/handlers/common'
import { createHandlers } from '@/lib/translation/handlers/articleTranslations'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).GET(req)
  } catch (error) {
    console.error('[api/articles/translations] GET failed', error)
    return routeError(error)
  }
}
