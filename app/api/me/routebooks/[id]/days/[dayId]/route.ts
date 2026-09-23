import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createDayHandlers } from '@/lib/routeBook/handlers/days'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'


export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; dayId: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createDayHandlers(deps).PATCH(req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/days/[dayId]/route.ts] PATCH failed', err)
    return routeBookErrorResponse(err)
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; dayId: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createDayHandlers(deps).PATCH(_req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/days/[dayId]/route.ts] DELETE failed', err)
    return routeBookErrorResponse(err)
  }
}
