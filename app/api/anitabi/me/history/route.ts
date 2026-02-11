export const runtime = 'nodejs'

import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { createHandlers } from '@/lib/anitabi/handlers/meHistory'

export async function POST(req: Request) {
  const deps = await getAnitabiApiDeps()
  return createHandlers(deps).POST(req)
}
