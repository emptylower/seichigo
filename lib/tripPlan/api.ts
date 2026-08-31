import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'

let cached: TripPlanHandlerDeps | null = null

export async function getTripPlanApiDeps(): Promise<TripPlanHandlerDeps> {
  if (cached) return cached

  const [{ PrismaTripPlanRepo }, { getServerAuthSession }] = await Promise.all([
    import('@/lib/tripPlan/repoPrisma'),
    import('@/lib/auth/session'),
  ])

  cached = {
    repo: new PrismaTripPlanRepo(),
    getSession: getServerAuthSession,
  }
  return cached
}
