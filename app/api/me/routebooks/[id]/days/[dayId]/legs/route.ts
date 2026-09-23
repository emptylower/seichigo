import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createLegHandlers } from '@/lib/routeBook/handlers/legs'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ id: string; dayId: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createLegHandlers(deps).GET(req, ctx)
  } catch (err) {
    console.error('[api/me/routebooks/[id]/days/[dayId]/legs] GET failed', err)
    return routeBookErrorResponse(err)
  }
}
