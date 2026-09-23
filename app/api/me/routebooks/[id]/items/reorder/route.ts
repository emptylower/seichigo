import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createItemHandlers } from '@/lib/routeBook/handlers/items'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'


export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createItemHandlers(deps).REORDER(req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/items/reorder/route.ts] POST failed', err)
    return routeBookErrorResponse(err)
  }
}
