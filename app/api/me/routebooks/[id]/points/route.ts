import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createHandlers } from '@/lib/routeBook/handlers/routebookPoints'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createHandlers(deps).POST(req, ctx)
  } catch (err) {
    console.error('[api/me/routebooks/[id]/points] POST failed', err)
    return routeBookErrorResponse(err)
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createHandlers(deps).DELETE(req, ctx)
  } catch (err) {
    console.error('[api/me/routebooks/[id]/points] DELETE failed', err)
    return routeBookErrorResponse(err)
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createHandlers(deps).PATCH(req, ctx)
  } catch (err) {
    console.error('[api/me/routebooks/[id]/points] PATCH failed', err)
    return routeBookErrorResponse(err)
  }
}
