export const runtime = 'nodejs'

import { getLlmAdminApiDeps } from '@/lib/llm/api'
import { createDiscoverModelsHandler } from '@/lib/llm/handlers/discoverModels'
import { routeError } from '@/lib/llm/handlers/common'

export async function POST(req: Request) {
  try {
    const deps = await getLlmAdminApiDeps()
    return createDiscoverModelsHandler(deps)(req)
  } catch (err) {
    console.error('[api/admin/llm/providers/discover-models] POST failed', err)
    return routeError(err)
  }
}
