import { getFavoriteApiDeps } from '@/lib/favorite/api'
import { createHandlers } from '@/lib/favorite/handlers/favoriteByArticleId'

export const runtime = 'nodejs'

export async function DELETE(req: Request, ctx: { params: Promise<{ articleId: string }> }) {
  const deps = await getFavoriteApiDeps()
  return createHandlers(deps).DELETE(req, ctx)
}
