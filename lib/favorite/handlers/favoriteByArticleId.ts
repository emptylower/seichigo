import { NextResponse } from 'next/server'
import type { FavoriteApiDeps } from '@/lib/favorite/api'

export function createHandlers(deps: FavoriteApiDeps) {
  return {
    async DELETE(_req: Request, ctx: { params?: Promise<{ articleId: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const { articleId } = (await ctx.params) || ({} as any)
      const id = String(articleId || '').trim()
      if (!id) {
        return NextResponse.json({ error: '缺少 articleId' }, { status: 400 })
      }

      await deps.repo.remove(session.user.id, { source: 'db', articleId: id })
      return NextResponse.json({ ok: true })
    },
  }
}

