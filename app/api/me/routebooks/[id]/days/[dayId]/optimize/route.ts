import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createOptimizeHandlers } from '@/lib/routeBook/handlers/optimize'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'


export async function POST(req: Request, ctx: { params: Promise<{ id: string; dayId: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createOptimizeHandlers(deps).POST(req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/days/[dayId]/optimize/route.ts] POST failed', err)
    return routeBookErrorResponse(err)
  }
}
