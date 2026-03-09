import { NextRequest } from 'next/server'
import { getTranslationApiDeps } from '@/lib/translation/api'
import { routeError } from '@/lib/translation/handlers/common'
import { createHandlers } from '@/lib/translation/handlers/taskHistory'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).GET(req, ctx)
  } catch (error) {
    console.error('[api/admin/translations/[id]/history] GET failed', error)
    return routeError(error)
  }
}
