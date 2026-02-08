import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ArticleRevisionStatus } from '@/lib/articleRevision/workflow'
import type { ArticleRevisionApiDeps } from '@/lib/articleRevision/api'

const querySchema = z.object({
  status: z.enum(['draft', 'in_review', 'rejected', 'approved']).optional(),
})

function toListItem(r: any) {
  return {
    id: r.id,
    articleId: r.articleId,
    authorId: r.authorId,
    title: r.title,
    status: r.status,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
  }
}

export function createHandlers(deps: ArticleRevisionApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }
      if (!session.user.isAdmin) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const url = new URL(req.url)
      const parsed = querySchema.safeParse({ status: url.searchParams.get('status') || undefined })
      if (!parsed.success) {
        return NextResponse.json({ error: '参数错误' }, { status: 400 })
      }

      const status = (parsed.data.status ?? 'in_review') as ArticleRevisionStatus
      const list = await deps.revisionRepo.listSummaryByStatus(status)
      return NextResponse.json({ ok: true, items: list.map(toListItem) })
    },
  }
}
