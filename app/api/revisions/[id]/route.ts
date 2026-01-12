export const runtime = 'nodejs'

import { getArticleRevisionApiDeps } from '@/lib/articleRevision/api'
import { createHandlers } from '@/lib/articleRevision/handlers/revisionById'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const deps = await getArticleRevisionApiDeps()
  return createHandlers(deps).GET(req, ctx)
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const deps = await getArticleRevisionApiDeps()
  return createHandlers(deps).PATCH(req, ctx)
}
