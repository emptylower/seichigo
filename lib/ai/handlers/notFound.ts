import { NextResponse } from 'next/server'
import type { AiApiDeps } from '@/lib/ai/api'
import { authorizeAiRequest } from '@/lib/ai/auth'

type Ctx = { params?: Promise<{ path?: string[] }> }

export function createHandlers(deps: AiApiDeps) {
  async function handle(req: Request, ctx: Ctx) {
    const auth = await authorizeAiRequest(req, deps)
    if (!auth.ok) {
      const status = auth.reason === 'forbidden' ? 403 : 401
      const error = auth.reason === 'forbidden' ? 'Forbidden: Admin access required' : 'Unauthorized'
      return NextResponse.json({ error }, { status })
    }

    const path = ((await ctx.params)?.path || []).join('/')
    return NextResponse.json({ error: 'Not Found', path: `/api/ai/${path}` }, { status: 404 })
  }

  return {
    GET: handle,
    POST: handle,
    PUT: handle,
    PATCH: handle,
    DELETE: handle,
  }
}
