import { NextRequest } from 'next/server'
import { getTranslationApiDeps } from '@/lib/translation/api'
import { routeError } from '@/lib/translation/handlers/common'
import { createHandlers } from '@/lib/translation/handlers/taskApprove'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).POST(req, ctx)
  } catch (error) {
    console.error('[api/admin/translations/[id]/approve] POST failed', error)
    return routeError(error)
  }
}
