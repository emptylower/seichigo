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
  if (p.publishedAt) return Date.parse(p.publishedAt) || 0
  if (p.publishDate) return Date.parse(p.publishDate) || 0
  return 0
}

function normalizeMdx(post: PostFrontmatter, fallbackAnimeId: string): PublicPostListItem {
  return {
    source: 'mdx',
    title: post.title,
    slug: post.slug,
    animeId: post.animeId || fallbackAnimeId,
    city: post.city || '',
    routeLength: post.routeLength,
    tags: post.tags || [],
    publishDate: post.publishDate,
  }
}

function normalizeDb(article: any): PublicPostListItem {
  const publishedAtIso =
    article?.publishedAt instanceof Date
      ? article.publishedAt.toISOString()
      : typeof article?.publishedAt === 'string'
        ? article.publishedAt
        : undefined

  return {
    source: 'db',
    title: String(article?.title || ''),
    slug: String(article?.slug || ''),
    animeId: String(article?.animeId || 'unknown'),
    city: String(article?.city || ''),
    routeLength: article?.routeLength ?? undefined,
    tags: Array.isArray(article?.tags) ? article.tags : [],
    publishDate: publishedAtIso ? publishedAtIso.slice(0, 10) : undefined,
    publishedAt: publishedAtIso,
  }
}

export async function getAllPublicPosts(language: string = 'zh', options?: GetAllPublicPostsOptions): Promise<PublicPostListItem[]> {
  const mdx = options?.mdx ?? { getAllPosts: getAllMdxPosts }
  const mdxPosts = await mdx.getAllPosts(language).catch(() => [])

  const repo = options?.articleRepo ?? (await getDefaultPublicArticleRepo())
  const dbPublished = repo ? await repo.listByStatus('published').catch(() => []) : []

  const bySlug = new Map<string, PublicPostListItem>()
  for (const p of mdxPosts) {
    if (!p?.slug || !p?.title) continue
    bySlug.set(p.slug, normalizeMdx(p, 'unknown'))
  }
  for (const a of dbPublished as any[]) {
    const item = normalizeDb(a)
    if (!item.slug || !item.title) continue
    if (bySlug.has(item.slug)) continue // MDX wins
    bySlug.set(item.slug, item)
  }

  return Array.from(bySlug.values()).sort((a, b) => {
    const dt = toTimestamp(b) - toTimestamp(a)
    if (dt !== 0) return dt
    return a.slug.localeCompare(b.slug)
  })
}

