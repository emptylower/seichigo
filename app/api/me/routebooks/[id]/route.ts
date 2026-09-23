import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createHandlers } from '@/lib/routeBook/handlers/routebooks'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createHandlers(deps).GET(req, ctx)
  } catch (err) {
    console.error('[api/me/routebooks/[id]] GET failed', err)
    return routeBookErrorResponse(err)
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createHandlers(deps).PATCH(req, ctx)
  } catch (err) {
    console.error('[api/me/routebooks/[id]] PATCH failed', err)
    return routeBookErrorResponse(err)
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createHandlers(deps).DELETE(req, ctx)
  } catch (err) {
    console.error('[api/me/routebooks/[id]] DELETE failed', err)
    return routeBookErrorResponse(err)
  }
}
