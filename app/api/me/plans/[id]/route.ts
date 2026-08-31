import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { createPlanByIdHandlers } from '@/lib/tripPlan/handlers/planById'

export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const deps = await getTripPlanApiDeps()
  return createPlanByIdHandlers(deps).GET(id)
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const deps = await getTripPlanApiDeps()
  return createPlanByIdHandlers(deps).PATCH(id, req)
}
