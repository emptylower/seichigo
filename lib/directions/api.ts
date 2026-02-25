import type { DirectionsHandlerDeps } from '@/lib/directions/handlers/directions'

let cached: DirectionsHandlerDeps | null = null

export async function getDirectionsApiDeps(): Promise<DirectionsHandlerDeps> {
  if (cached) return cached

  const [{ getServerAuthSession }] = await Promise.all([
    import('@/lib/auth/session'),
  ])

  const apiKey = process.env.GOOGLE_DIRECTIONS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''
  if (!apiKey) {
    console.warn('[directions] GOOGLE_DIRECTIONS_API_KEY not set, Directions API will fail')
  }

  cached = {
    getSession: getServerAuthSession,
    apiKey,
  }

  return cached
}
