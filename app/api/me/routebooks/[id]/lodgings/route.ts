import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createLodgingHandlers } from '@/lib/routeBook/handlers/lodgings'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'


export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createLodgingHandlers(deps).POST(req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/lodgings/route.ts] POST failed', err)
    return routeBookErrorResponse(err)
  }
}
