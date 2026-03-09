import { NextRequest } from 'next/server'
import { getTranslationApiDeps } from '@/lib/translation/api'
import { routeError } from '@/lib/translation/handlers/common'
import { createHandlers } from '@/lib/translation/handlers/batch'

export async function POST(req: NextRequest) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).POST(req)
  } catch (err) {
    console.error('[api/admin/translations/batch] POST failed', err)
    return routeError(err)
  }
}
