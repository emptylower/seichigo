import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ArticleStatus } from '@/lib/article/workflow'
import type { ArticleApiDeps } from '@/lib/article/api'

const querySchema = z.object({
  status: z.enum(['draft', 'in_review', 'rejected', 'published']).optional(),
})

function toListItem(a: any) {
  return {
    id: a.id,
    authorId: a.authorId,
    slug: a.slug,
    title: a.title,
    status: a.status,
    updatedAt: a.updatedAt,
    createdAt: a.createdAt,
  }
}

export function createHandlers(deps: ArticleApiDeps) {
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

      const status = (parsed.data.status ?? 'in_review') as ArticleStatus
      const list = await deps.repo.listSummaryByStatus(status)
      return NextResponse.json({ ok: true, items: list.map(toListItem) })
    },
  }
}
