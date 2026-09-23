import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createItemHandlers } from '@/lib/routeBook/handlers/items'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'


export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createItemHandlers(deps).PATCH(req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/items/[itemId]/route.ts] PATCH failed', err)
    return routeBookErrorResponse(err)
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createItemHandlers(deps).PATCH(_req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/items/[itemId]/route.ts] DELETE failed', err)
    return routeBookErrorResponse(err)
  }
}
