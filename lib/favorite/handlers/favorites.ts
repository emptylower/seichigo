import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FavoriteApiDeps } from '@/lib/favorite/api'
import type { FavoriteTarget } from '@/lib/favorite/repo'

const addSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('db'), articleId: z.string().min(1) }),
  z.object({ source: z.literal('mdx'), slug: z.string().min(1) }),
])

type FavoriteListItem =
  | { source: 'db'; articleId: string; slug: string; title: string; createdAt: string }
  | { source: 'mdx'; slug: string; title: string; createdAt: string }

async function resolveList(deps: FavoriteApiDeps, userId: string): Promise<FavoriteListItem[]> {
  const favorites = await deps.repo.listByUser(userId)

  const mdxPosts = await deps.mdx.getAllPosts(deps.language).catch(() => [])
  const mdxBySlug = new Map(mdxPosts.map((p) => [p.slug, p]))

  const items: FavoriteListItem[] = []

  for (const f of favorites) {
    if (f.source === 'db') {
      const article = await deps.articleRepo.findById(f.articleId).catch(() => null)
      if (!article || article.status !== 'published') continue
      items.push({
        source: 'db',
        articleId: f.articleId,
        slug: article.slug,
        title: article.title,
        createdAt: f.createdAt.toISOString(),
      })
      continue
    }

    const post = mdxBySlug.get(f.slug)
    if (!post) continue
    items.push({
      source: 'mdx',
      slug: post.slug,
      title: post.title,
      createdAt: f.createdAt.toISOString(),
    })
  }

  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function createHandlers(deps: FavoriteApiDeps) {
  return {
    async GET(_req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const items = await resolveList(deps, session.user.id)
      return NextResponse.json({ ok: true, items })
    },

    async POST(req: Request) {
      const session = await deps.getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }

      const body = await req.json().catch(() => null)
      const parsed = addSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || '参数错误' }, { status: 400 })
      }

      const target = parsed.data as FavoriteTarget
      await deps.repo.add(session.user.id, target)
      return NextResponse.json({ ok: true })
    },
  }
}

