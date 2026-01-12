import { describe, expect, it } from 'vitest'
import { InMemoryArticleRepo } from '@/lib/article/repoMemory'
import { InMemoryFavoriteRepo } from '@/lib/favorite/repoMemory'
import type { FavoriteApiDeps } from '@/lib/favorite/api'
import type { PostFrontmatter } from '@/lib/mdx/types'

import { createHandlers as createFavoritesHandlers } from '@/lib/favorite/handlers/favorites'
import { createHandlers as createFavoriteArticleHandlers } from '@/lib/favorite/handlers/favoriteByArticleId'
import { createHandlers as createFavoriteMdxHandlers } from '@/lib/favorite/handlers/favoriteMdxBySlug'

function jsonReq(url: string, method: string, body?: any): Request {
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

function makeDeps(options?: {
  session?: any
  mdxPosts?: PostFrontmatter[]
  now?: Date
}): { deps: FavoriteApiDeps; setSession: (s: any) => void } {
  let currentSession: any = options?.session ?? null
  const now = options?.now ?? new Date('2025-01-01T00:00:00.000Z')

  const articleRepo = new InMemoryArticleRepo({ now: () => now })
  const repo = new InMemoryFavoriteRepo({ now: () => now })
  const mdxPosts = options?.mdxPosts ?? []

  const deps: FavoriteApiDeps = {
    repo,
    articleRepo,
    getSession: async () => currentSession,
    mdx: {
      getAllPosts: async () => mdxPosts,
    },
    language: 'zh',
  }

  return { deps, setSession: (s) => (currentSession = s) }
}

describe('favorite api', () => {
  it('requires auth', async () => {
    const { deps } = makeDeps()
    const favorites = createFavoritesHandlers(deps)
    const delDb = createFavoriteArticleHandlers(deps)
    const delMdx = createFavoriteMdxHandlers(deps)

    expect((await favorites.GET(jsonReq('http://localhost/api/favorites', 'GET'))).status).toBe(401)
    expect((await favorites.POST(jsonReq('http://localhost/api/favorites', 'POST', { source: 'db', articleId: 'a1' }))).status).toBe(401)
    expect((await delDb.DELETE(jsonReq('http://localhost/api/favorites/a1', 'DELETE'), { params: Promise.resolve({ articleId: 'a1' }) })).status).toBe(401)
    expect((await delMdx.DELETE(jsonReq('http://localhost/api/favorites/mdx/mdx-1', 'DELETE'), { params: Promise.resolve({ slug: 'mdx-1' }) })).status).toBe(401)
  })

  it('lists only published DB favorites (hides down/unpublished)', async () => {
    const { deps } = makeDeps({ session: { user: { id: 'u1' } } })
    const favorites = createFavoritesHandlers(deps)

    const pub = await deps.articleRepo.createDraft({ authorId: 'a', slug: 'pub', title: 'Pub' })
    const draft = await deps.articleRepo.createDraft({ authorId: 'a', slug: 'draft', title: 'Draft' })
    await deps.articleRepo.updateState(pub.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    const add1 = await favorites.POST(jsonReq('http://localhost/api/favorites', 'POST', { source: 'db', articleId: pub.id }))
    expect(add1.status).toBe(200)
    const add2 = await favorites.POST(jsonReq('http://localhost/api/favorites', 'POST', { source: 'db', articleId: draft.id }))
    expect(add2.status).toBe(200)

    const listRes = await favorites.GET(jsonReq('http://localhost/api/favorites', 'GET'))
    const list = await listRes.json()
    expect(list.ok).toBe(true)
    expect(list.items.map((x: any) => x.slug)).toEqual(['pub'])
  })

  it('supports MDX favorites and hides missing/draft slugs', async () => {
    const { deps } = makeDeps({
      session: { user: { id: 'u1' } },
      mdxPosts: [
        { title: 'MDX 1', slug: 'mdx-1', animeId: 'btr', city: '东京', status: 'published', tags: [] },
      ],
    })
    const favorites = createFavoritesHandlers(deps)

    await favorites.POST(jsonReq('http://localhost/api/favorites', 'POST', { source: 'mdx', slug: 'mdx-1' }))
    await favorites.POST(jsonReq('http://localhost/api/favorites', 'POST', { source: 'mdx', slug: 'mdx-draft' }))

    const listRes = await favorites.GET(jsonReq('http://localhost/api/favorites', 'GET'))
    const list = await listRes.json()
    expect(list.ok).toBe(true)
    expect(list.items.map((x: any) => x.slug)).toEqual(['mdx-1'])
    expect(list.items[0]?.source).toBe('mdx')
  })

  it('delete endpoints are idempotent', async () => {
    const { deps } = makeDeps({
      session: { user: { id: 'u1' } },
      mdxPosts: [{ title: 'MDX 1', slug: 'mdx-1', animeId: 'btr', city: '东京', status: 'published', tags: [] }],
    })
    const favorites = createFavoritesHandlers(deps)
    const delDb = createFavoriteArticleHandlers(deps)
    const delMdx = createFavoriteMdxHandlers(deps)

    const pub = await deps.articleRepo.createDraft({ authorId: 'a', slug: 'pub', title: 'Pub' })
    await deps.articleRepo.updateState(pub.id, { status: 'published', publishedAt: new Date('2025-01-01T00:00:00.000Z') })

    await favorites.POST(jsonReq('http://localhost/api/favorites', 'POST', { source: 'db', articleId: pub.id }))
    await favorites.POST(jsonReq('http://localhost/api/favorites', 'POST', { source: 'mdx', slug: 'mdx-1' }))

    const d1 = await delDb.DELETE(jsonReq('http://localhost/api/favorites/' + pub.id, 'DELETE'), { params: Promise.resolve({ articleId: pub.id }) })
    expect(d1.status).toBe(200)
    const d2 = await delDb.DELETE(jsonReq('http://localhost/api/favorites/' + pub.id, 'DELETE'), { params: Promise.resolve({ articleId: pub.id }) })
    expect(d2.status).toBe(200)

    const m1 = await delMdx.DELETE(jsonReq('http://localhost/api/favorites/mdx/mdx-1', 'DELETE'), { params: Promise.resolve({ slug: 'mdx-1' }) })
    expect(m1.status).toBe(200)
    const m2 = await delMdx.DELETE(jsonReq('http://localhost/api/favorites/mdx/mdx-1', 'DELETE'), { params: Promise.resolve({ slug: 'mdx-1' }) })
    expect(m2.status).toBe(200)
  })
})

