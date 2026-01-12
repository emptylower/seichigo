import type { ArticleRepo } from '@/lib/article/repo'
import type { Post } from '@/lib/mdx/types'
import { getPostBySlug as getMdxPostBySlug } from '@/lib/mdx/getPostBySlug'
import { getDefaultPublicArticleRepo, type PublicArticleRepo } from './defaults'
import type { PublicPost } from './types'
import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'
import { generateSlugFromTitle, isFallbackHashSlug } from '@/lib/article/slug'
import { renderRichTextEmbeds } from '@/lib/richtext/embeds'

type MdxProvider = {
  getPostBySlug: (slug: string, language: string) => Promise<Post | null>
}

export type GetPublicPostBySlugOptions = {
  mdx?: MdxProvider
  articleRepo?: Pick<ArticleRepo, 'findById' | 'findBySlug'> | PublicArticleRepo
}

type RepoWithListByStatus = Pick<ArticleRepo, 'listByStatus'>
function hasListByStatus(repo: unknown): repo is RepoWithListByStatus {
  return typeof (repo as any)?.listByStatus === 'function'
}

function extractArticleIdFromPostKey(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const uuid = trimmed.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)
  if (uuid) return uuid[0]

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
      const sanitized = sanitizeRichTextHtml(found.contentHtml || '', { imageMode: 'progressive' })
      const contentHtml = renderRichTextEmbeds(sanitized, (found as any).contentJson)
      return { source: 'db', article: { ...found, contentHtml } }
    }
  }

  const article = await repo.findBySlug(target).catch(() => null)
  if (article) {
    if (article.status !== 'published') return null
    const sanitized = sanitizeRichTextHtml(article.contentHtml || '', { imageMode: 'progressive' })
    const contentHtml = renderRichTextEmbeds(sanitized, (article as any).contentJson)
    return { source: 'db', article: { ...article, contentHtml } }
  }

  // Legacy support: resolve old fallback hash slug (post-<sha1>) by scanning published articles.
  // This enables redirecting old slugs after an admin upgrades them to a readable slug.
  if (isFallbackHashSlug(target) && hasListByStatus(repo)) {
    const published = await repo.listByStatus('published').catch(() => [])
    for (const a of published as any[]) {
      const title = String(a?.title || '')
      if (!title) continue
      const legacy = generateSlugFromTitle(title, new Date('2025-01-01T00:00:00.000Z'))
      if (legacy !== target) continue
      if (a?.status !== 'published') continue
      const sanitized = sanitizeRichTextHtml(a.contentHtml || '', { imageMode: 'progressive' })
      const contentHtml = renderRichTextEmbeds(sanitized, (a as any).contentJson)
      return { source: 'db', article: { ...a, contentHtml } }
    }
  }

  return null
}
