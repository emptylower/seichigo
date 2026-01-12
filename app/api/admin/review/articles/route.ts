export const runtime = 'nodejs'

import { getArticleApiDeps } from '@/lib/article/api'
import { createHandlers } from '@/lib/article/handlers/adminReviewList'

export async function GET(req: Request) {
  const deps = await getArticleApiDeps()
  return createHandlers(deps).GET(req)
}
