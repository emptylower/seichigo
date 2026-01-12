import { getFavoriteApiDeps } from '@/lib/favorite/api'
import { createHandlers } from '@/lib/favorite/handlers/favoriteMdxBySlug'

export const runtime = 'nodejs'

export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const deps = await getFavoriteApiDeps()
  return createHandlers(deps).DELETE(req, ctx)
}
