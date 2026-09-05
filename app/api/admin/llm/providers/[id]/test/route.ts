export const runtime = 'nodejs'

import { getLlmAdminApiDeps } from '@/lib/llm/api'
import { createHandlers } from '@/lib/llm/handlers/adminProviders'
import { routeError } from '@/lib/llm/handlers/common'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const deps = await getLlmAdminApiDeps()
    return createHandlers(deps).TEST(req, id)
  } catch (err) {
    console.error('[api/admin/llm/providers/:id/test] POST failed', err)
    return routeError(err)
  }
}
