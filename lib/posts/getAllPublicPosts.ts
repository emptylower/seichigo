import type { ArticleRepo } from '@/lib/article/repo'
import type { PostFrontmatter } from '@/lib/mdx/types'
import { getAllPosts as getAllMdxPosts } from '@/lib/mdx/getAllPosts'
import { getDefaultPublicArticleRepo, type PublicArticleRepo } from './defaults'
import type { PublicPostListItem } from './types'

type MdxProvider = {
  getAllPosts: (language: string) => Promise<PostFrontmatter[]>
}

export type GetAllPublicPostsOptions = {
  mdx?: MdxProvider
  articleRepo?: Pick<ArticleRepo, 'listByStatus'> | PublicArticleRepo
}

function toTimestamp(p: PublicPostListItem): number {
  if (p.updatedAt) return Date.parse(p.updatedAt) || 0
  if (p.publishedAt) return Date.parse(p.publishedAt) || 0
  if (p.publishDate) return Date.parse(p.publishDate) || 0
  return 0
}

function normalizeMdx(post: PostFrontmatter, fallbackAnimeId: string): PublicPostListItem {
  return {
    source: 'mdx',
    title: post.title,
    path: `/posts/${post.slug}`,
    animeIds: [post.animeId || fallbackAnimeId].filter(Boolean),
    city: post.city || '',
    routeLength: post.routeLength,
    tags: post.tags || [],
    cover: null,
    publishDate: post.publishDate,
    updatedAt: post.updatedDate || post.publishDate,
  }
}

function normalizeDb(article: any): PublicPostListItem {
  const publishedAtIso =
    article?.publishedAt instanceof Date
      ? article.publishedAt.toISOString()
      : typeof article?.publishedAt === 'string'
        ? article.publishedAt
        : undefined

  const lastApprovedAtIso =
    article?.lastApprovedAt instanceof Date
      ? article.lastApprovedAt.toISOString()
      : typeof article?.lastApprovedAt === 'string'
        ? article.lastApprovedAt
        : undefined

  const recordUpdatedAtIso =
    article?.updatedAt instanceof Date
      ? article.updatedAt.toISOString()
      : typeof article?.updatedAt === 'string'
        ? article.updatedAt
        : undefined

  // For public ordering, prefer approval times (publish/approve revision).
  // `updatedAt` may drift due to internal updates, so we don't rely on it.
  const effectiveUpdatedAtIso = lastApprovedAtIso || publishedAtIso || recordUpdatedAtIso

  return {
    source: 'db',
    title: String(article?.title || ''),
    path: `/posts/${String(article?.slug || '')}`.replace(/\/posts\/$/, '/posts'),
    animeIds: Array.isArray(article?.animeIds) ? article.animeIds : [],
    city: String(article?.city || ''),
    routeLength: article?.routeLength ?? undefined,
    tags: Array.isArray(article?.tags) ? article.tags : [],
    cover: article?.cover ?? null,
    publishDate: publishedAtIso ? publishedAtIso.slice(0, 10) : undefined,
    publishedAt: publishedAtIso,
    updatedAt: effectiveUpdatedAtIso,
  }
}

export async function getAllPublicPosts(language: string = 'zh', options?: GetAllPublicPostsOptions): Promise<PublicPostListItem[]> {
  const mdx = options?.mdx ?? { getAllPosts: getAllMdxPosts }
  const mdxPosts = await mdx.getAllPosts(language).catch(() => [])

  const repo = options?.articleRepo ?? (await getDefaultPublicArticleRepo())
  const dbPublished = repo ? await repo.listByStatus('published').catch(() => []) : []

  const byPath = new Map<string, PublicPostListItem>()
  for (const p of mdxPosts) {
    if (!p?.slug || !p?.title) continue
    const item = normalizeMdx(p, 'unknown')
    if (!item.path) continue
    byPath.set(item.path, item)
  }
  for (const a of dbPublished as any[]) {
    const item = normalizeDb(a)
    if (!item.path || !item.title) continue
    if (byPath.has(item.path)) continue
    byPath.set(item.path, item)
  }

  return Array.from(byPath.values()).sort((a, b) => {
    const dt = toTimestamp(b) - toTimestamp(a)
    if (dt !== 0) return dt
    return a.path.localeCompare(b.path)
  })
}
