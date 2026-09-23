import { getRouteBookApiDeps } from '@/lib/routeBook/api'
import { createExportHandlers } from '@/lib/routeBook/handlers/export'
import { routeBookErrorResponse } from '@/lib/routeBook/handlers/errors'

export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const deps = await getRouteBookApiDeps()
    return await createExportHandlers(deps).GET_gpx(req, ctx)
  } catch (err) {
    console.error('[app/api/me/routebooks/[id]/export.gpx/route.ts] GET failed', err)
    return routeBookErrorResponse(err)
  }
}
