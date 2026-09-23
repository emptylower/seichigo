import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createPlaceIntroHandlers } from '@/lib/routeBook/handlers/placeIntro'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ id: string; placeId: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createPlaceIntroHandlers(deps).GET(req, ctx)
  } catch (err) {
    console.error('[api/me/routebooks/[id]/places/[placeId]/intro] GET failed', err)
    return routeBookErrorResponse(err)
  }
}
