import type { WeatherApiDeps } from '@/lib/weather/handlers/weather'

let cached: WeatherApiDeps | null = null

export async function getWeatherApiDeps(): Promise<WeatherApiDeps> {
  if (cached) return cached

  const [{ getServerAuthSession }] = await Promise.all([import('@/lib/auth/session')])

  cached = { getSession: getServerAuthSession }
  return cached
}
