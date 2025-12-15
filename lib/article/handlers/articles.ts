import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ArticleSlugExistsError } from '@/lib/article/repo'
import type { ArticleStatus } from '@/lib/article/workflow'
import type { ArticleApiDeps } from '@/lib/article/api'
import { generateSlugFromTitle } from '@/lib/article/slug'

const createSchema = z.object({
  title: z.string().min(1).refine((v) => v.trim().length > 0, { message: '标题不能为空' }),
  animeIds: z.array(z.string()).optional(),
  city: z.string().nullable().optional(),
  routeLength: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  contentJson: z.unknown().nullable().optional(),
  contentHtml: z.string().optional(),
})

const listQuerySchema = z.object({
  scope: z.literal('mine').optional(),
  status: z.enum(['draft', 'in_review', 'rejected', 'published']).optional(),
})

function toListItem(a: any) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    animeIds: a.animeIds,
    city: a.city,
    routeLength: a.routeLength,
    tags: a.tags,
    status: a.status,
    rejectReason: a.rejectReason,
    publishedAt: a.publishedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

export function createHandlers(deps: ArticleApiDeps) {
  return {
    async POST(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const body = await req.json().catch(() => null)
      if (body && typeof body === 'object' && 'slug' in (body as any)) {
        return NextResponse.json({ error: 'slug 不支持自定义' }, { status: 400 })
      }
      const parsed = createSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const baseSlug = generateSlugFromTitle(parsed.data.title, deps.now())
      const contentHtml = parsed.data.contentHtml ? deps.sanitizeHtml(parsed.data.contentHtml) : ''

      const maxAttempts = 20
      for (let i = 0; i < maxAttempts; i++) {
        const suffix = i === 0 ? '' : `-${i + 1}`
        const candidate = `${baseSlug}${suffix}`
        try {
          const created = await deps.repo.createDraft({
            authorId: session.user.id,
            slug: candidate,
            title: parsed.data.title,
            animeIds: parsed.data.animeIds,
            city: parsed.data.city,
            routeLength: parsed.data.routeLength,
            tags: parsed.data.tags,
            contentJson: parsed.data.contentJson ?? null,
            contentHtml,
          })
          return NextResponse.json({ ok: true, article: toListItem(created) })
        } catch (err) {
          if (err instanceof ArticleSlugExistsError) continue
          throw err
        }
      }

      return NextResponse.json({ error: '无法生成唯一 slug，请稍后重试' }, { status: 409 })
    },

    async GET(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const url = new URL(req.url)
      const parsed = listQuerySchema.safeParse({
        scope: url.searchParams.get('scope') || undefined,
        status: url.searchParams.get('status') || undefined,
      })
      if (!parsed.success) {
        return NextResponse.json({ error: '参数错误' }, { status: 400 })
      }

      const scope = parsed.data.scope ?? 'mine'
      if (scope !== 'mine') {
        return NextResponse.json({ error: '暂不支持该 scope' }, { status: 400 })
      }

      const all = await deps.repo.listByAuthor(session.user.id)
      const status = parsed.data.status as ArticleStatus | undefined
      const filtered = status ? all.filter((a) => a.status === status) : all
      return NextResponse.json({ ok: true, items: filtered.map(toListItem) })
    },
  }
}
