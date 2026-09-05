export const runtime = 'nodejs'

import { getLlmAdminApiDeps } from '@/lib/llm/api'
import { createHandlers } from '@/lib/llm/handlers/adminProviders'
import { routeError } from '@/lib/llm/handlers/common'

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const deps = await getLlmAdminApiDeps()
    return createHandlers(deps).PUT(req, id)
  } catch (err) {
    console.error('[api/admin/llm/providers/:id] PUT failed', err)
    return routeError(err)
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const deps = await getLlmAdminApiDeps()
    return createHandlers(deps).DELETE(id)
  } catch (err) {
    console.error('[api/admin/llm/providers/:id] DELETE failed', err)
    return routeError(err)
  }
}
