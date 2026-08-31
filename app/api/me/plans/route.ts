import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { createPlansHandlers } from '@/lib/tripPlan/handlers/plans'

export const runtime = 'nodejs'

export async function GET() {
  const deps = await getTripPlanApiDeps()
  return createPlansHandlers(deps).GET()
}

export async function POST(req: Request) {
  const deps = await getTripPlanApiDeps()
  return createPlansHandlers(deps).POST(req)
}
