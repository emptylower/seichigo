export const runtime = 'nodejs'

import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { createHandlers } from '@/lib/anitabi/handlers/meState'

export async function GET(req: Request) {
  const deps = await getAnitabiApiDeps()
  return createHandlers(deps).GET(req)
}
