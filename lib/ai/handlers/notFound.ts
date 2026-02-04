import { NextResponse } from 'next/server'
import type { AiApiDeps } from '@/lib/ai/api'

type Ctx = { params?: Promise<{ path?: string[] }> }

export function createHandlers(deps: AiApiDeps) {
  async function handle(_req: Request, ctx: Ctx) {
    const session = await deps.getSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!deps.isAdminEmail(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
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
