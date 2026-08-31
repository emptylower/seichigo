import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { createExportRouteBookHandler } from '@/lib/tripPlan/handlers/exportRouteBook'
import { PrismaRouteBookExportStore } from '@/lib/routeBook/exportStorePrisma'

export const runtime = 'nodejs'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const deps = await getTripPlanApiDeps()
  return createExportRouteBookHandler({ ...deps, routeBookStore: new PrismaRouteBookExportStore() }).POST(id)
}
