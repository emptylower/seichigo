import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createLodgingHandlers } from '@/lib/routeBook/handlers/lodgings'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'


export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; lodgingId: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createLodgingHandlers(deps).PATCH(req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/lodgings/[lodgingId]/route.ts] PATCH failed', err)
    return routeBookErrorResponse(err)
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; lodgingId: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createLodgingHandlers(deps).PATCH(_req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/lodgings/[lodgingId]/route.ts] DELETE failed', err)
    return routeBookErrorResponse(err)
  }
}
