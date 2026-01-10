import { NextResponse } from 'next/server'
import type { ArticleRevisionApiDeps } from '@/lib/articleRevision/api'

function toRevisionListItem(r: any) {
  return {
    id: r.id,
    articleId: r.articleId,
    authorId: r.authorId,
    status: r.status,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
  }
}

export function createHandlers(deps: ArticleRevisionApiDeps) {
  return {
    async POST(_req: Request, ctx: { params?: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const { id } = (await ctx.params) || {}
      if (!id) {
        return NextResponse.json({ error: '缺少 id' }, { status: 400 })
      }

      const article = await deps.articleRepo.findById(id)
      if (!article) {
        return NextResponse.json({ error: '未找到文章' }, { status: 404 })
      }

      if (article.authorId !== session.user.id) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      if (article.status !== 'published') {
        return NextResponse.json({ error: '当前文章未发布，无法发起更新' }, { status: 409 })
      }

      const revision = await deps.revisionRepo.getOrCreateActiveFromArticle(article)

      return NextResponse.json({ ok: true, revision: toRevisionListItem(revision) })
    },
  }
}

