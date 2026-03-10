import { NextRequest } from 'next/server'
import { getTranslationApiDeps } from '@/lib/translation/api'
import { routeError } from '@/lib/translation/handlers/common'
import { createHandlers } from '@/lib/translation/handlers/retranslateApply'

export async function POST(req: NextRequest) {
  try {
    const deps = await getTranslationApiDeps()
    return createHandlers(deps).POST(req)
  } catch (error) {
    console.error('[api/admin/retranslate/apply] POST failed', error)
    return routeError(error)
  }
}
