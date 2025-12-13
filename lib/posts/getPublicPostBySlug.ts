import type { ArticleRepo } from '@/lib/article/repo'
import type { Post } from '@/lib/mdx/types'
import { getPostBySlug as getMdxPostBySlug } from '@/lib/mdx/getPostBySlug'
import { getDefaultPublicArticleRepo, type PublicArticleRepo } from './defaults'
import type { PublicPost } from './types'

type MdxProvider = {
  getPostBySlug: (slug: string, language: string) => Promise<Post | null>
}

export type GetPublicPostBySlugOptions = {
  mdx?: MdxProvider
  articleRepo?: Pick<ArticleRepo, 'findBySlug'> | PublicArticleRepo
}

export async function getPublicPostBySlug(
  slug: string,
  language: string = 'zh',
  options?: GetPublicPostBySlugOptions
): Promise<PublicPost | null> {
  const target = slug.trim()
  if (!target) return null

  const mdx = options?.mdx ?? { getPostBySlug: getMdxPostBySlug }
  const mdxPost = await mdx.getPostBySlug(target, language).catch(() => null)
  if (mdxPost) return { source: 'mdx', post: mdxPost }

  const repo = options?.articleRepo ?? (await getDefaultPublicArticleRepo())
  if (!repo) return null

  const article = await repo.findBySlug(target).catch(() => null)
  if (!article) return null
  if (article.status !== 'published') return null
  return { source: 'db', article }
}

