import { getFavoriteApiDeps } from '@/lib/favorite/api'
import { createHandlers } from '@/lib/favorite/handlers/favorites'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const deps = await getFavoriteApiDeps()
  return createHandlers(deps).GET(req)
}

export async function POST(req: Request) {
  const deps = await getFavoriteApiDeps()
  return createHandlers(deps).POST(req)
}
