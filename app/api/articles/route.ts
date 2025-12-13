import { getArticleApiDeps } from '@/lib/article/api'
import { createHandlers } from '@/lib/article/handlers/articles'

export async function GET(req: Request) {
  const deps = await getArticleApiDeps()
  return createHandlers(deps).GET(req)
}

export async function POST(req: Request) {
  const deps = await getArticleApiDeps()
  return createHandlers(deps).POST(req)
}
