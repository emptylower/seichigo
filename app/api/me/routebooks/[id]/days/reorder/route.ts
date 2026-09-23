import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createDayHandlers } from '@/lib/routeBook/handlers/days'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'


export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createDayHandlers(deps).REORDER(req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/days/reorder/route.ts] POST failed', err)
    return routeBookErrorResponse(err)
  }
}
