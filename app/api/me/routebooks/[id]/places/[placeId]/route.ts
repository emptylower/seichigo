import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createPlaceHandlers } from '@/lib/routeBook/handlers/places'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'


export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; placeId: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createPlaceHandlers(deps).PATCH(req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/places/[placeId]/route.ts] PATCH failed', err)
    return routeBookErrorResponse(err)
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; placeId: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createPlaceHandlers(deps).PATCH(_req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/places/[placeId]/route.ts] DELETE failed', err)
    return routeBookErrorResponse(err)
  }
}
