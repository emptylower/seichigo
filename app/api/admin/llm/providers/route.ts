export const runtime = 'nodejs'

import { getLlmAdminApiDeps } from '@/lib/llm/api'
import { createHandlers } from '@/lib/llm/handlers/adminProviders'
import { routeError } from '@/lib/llm/handlers/common'

export async function GET() {
  try {
    const deps = await getLlmAdminApiDeps()
    return createHandlers(deps).GET()
  } catch (err) {
    console.error('[api/admin/llm/providers] GET failed', err)
    return routeError(err)
  }
}

export async function POST(req: Request) {
  try {
    const deps = await getLlmAdminApiDeps()
    return createHandlers(deps).POST(req)
  } catch (err) {
    console.error('[api/admin/llm/providers] POST failed', err)
    return routeError(err)
  }
}
