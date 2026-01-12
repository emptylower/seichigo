export const runtime = 'nodejs'

import { getArticleRevisionApiDeps } from '@/lib/articleRevision/api'
import { createHandlers } from '@/lib/articleRevision/handlers/adminReviewList'

export async function GET(req: Request) {
  const deps = await getArticleRevisionApiDeps()
  return createHandlers(deps).GET(req)
}
