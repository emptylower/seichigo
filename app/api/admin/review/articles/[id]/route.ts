import { getArticleApiDeps } from '@/lib/article/api'
import { createHandlers } from '@/lib/article/handlers/adminReviewArticle'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const deps = await getArticleApiDeps()
  return createHandlers(deps).PATCH(req, ctx)
}

