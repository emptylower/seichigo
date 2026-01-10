import { getArticleRevisionApiDeps } from '@/lib/articleRevision/api'
import { createHandlers } from '@/lib/articleRevision/handlers/submit'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const deps = await getArticleRevisionApiDeps()
  return createHandlers(deps).POST(req, ctx)
}

