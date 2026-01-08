import type { ArticleRepo } from '@/lib/article/repo'
import type { Post } from '@/lib/mdx/types'
import { getPostBySlug as getMdxPostBySlug } from '@/lib/mdx/getPostBySlug'
import { getDefaultPublicArticleRepo, type PublicArticleRepo } from './defaults'
import type { PublicPost } from './types'
import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'

type MdxProvider = {
  getPostBySlug: (slug: string, language: string) => Promise<Post | null>
}

export type GetPublicPostBySlugOptions = {
  mdx?: MdxProvider
  articleRepo?: Pick<ArticleRepo, 'findById' | 'findBySlug'> | PublicArticleRepo
}

function extractArticleIdFromPostKey(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const idx = trimmed.indexOf('-')
  const candidate = idx === -1 ? trimmed : trimmed.slice(0, idx)
  const id = candidate.trim()
  if (!id) return null
  if (id.length < 8) return null
  return id
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

  const id = extractArticleIdFromPostKey(target)
  if (id && 'findById' in repo) {
    const found = await repo.findById(id).catch(() => null)
    if (found && found.status === 'published') {
      return { source: 'db', article: { ...found, contentHtml: sanitizeRichTextHtml(found.contentHtml || '', { imageMode: 'progressive' }) } }
    }
  }

  const article = await repo.findBySlug(target).catch(() => null)
  if (!article) return null
  if (article.status !== 'published') return null
  return { source: 'db', article: { ...article, contentHtml: sanitizeRichTextHtml(article.contentHtml || '', { imageMode: 'progressive' }) } }
}
