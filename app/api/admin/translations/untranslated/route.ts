import { NextRequest } from 'next/server'
import { getTranslationApiDeps } from '@/lib/translation/api'
import { routeError } from '@/lib/translation/handlers/common'
import { createHandlers } from '@/lib/translation/handlers/untranslated'

export async function GET(req: NextRequest) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).GET(req)
  } catch (err) {
    console.error('[api/admin/translations/untranslated] GET failed', err)
    return routeError(err)
  }
}
