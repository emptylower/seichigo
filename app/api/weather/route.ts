import { getServerAuthSession } from '@/lib/auth/session'
import { createWeatherHandlers } from '@/lib/weather/handlers/weather'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    return await createWeatherHandlers({ getSession: getServerAuthSession }).GET(req)
  } catch (err) {
    console.error('[api/weather] GET failed', err)
    return Response.json({ ok: true, days: [] }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
  }
}
