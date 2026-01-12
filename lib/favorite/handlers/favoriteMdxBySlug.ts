import { NextResponse } from 'next/server'
import type { FavoriteApiDeps } from '@/lib/favorite/api'

export function createHandlers(deps: FavoriteApiDeps) {
  return {
    async DELETE(_req: Request, ctx: { params?: Promise<{ slug: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const { slug } = (await ctx.params) || ({} as any)
      const s = String(slug || '').trim()
      if (!s) {
        return NextResponse.json({ error: '缺少 slug' }, { status: 400 })
      }

      await deps.repo.remove(session.user.id, { source: 'mdx', slug: s })
      return NextResponse.json({ ok: true })
    },
  }
}

