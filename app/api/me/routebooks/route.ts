import { NextResponse } from 'next/server'
import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createHandlers } from '@/lib/routeBook/handlers/routebooks'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createHandlers(deps).GET(req)
  } catch (err) {
    console.error('[api/me/routebooks] GET failed', err)
    return routeBookErrorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createHandlers(deps).POST(req)
  } catch (err) {
    console.error('[api/me/routebooks] POST failed', err)
    return routeBookErrorResponse(err)
  }
}
