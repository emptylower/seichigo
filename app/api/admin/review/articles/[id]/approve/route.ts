import { getArticleApiDeps } from '@/lib/article/api'
import { createHandlers } from '@/lib/article/handlers/adminApprove'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const deps = await getArticleApiDeps()
  return createHandlers(deps).POST(req, ctx)
}
