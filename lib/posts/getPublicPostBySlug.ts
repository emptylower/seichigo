import type { ArticleRepo } from '@/lib/article/repo'
import type { Post } from '@/lib/mdx/types'
import { getPostBySlug as getMdxPostBySlug } from '@/lib/mdx/getPostBySlug'
import { getDefaultPublicArticleRepo, type PublicArticleRepo } from './defaults'
import type { PublicPost } from './types'
import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'
import { generateSlugFromTitle, isFallbackHashSlug, normalizeArticleSlug } from '@/lib/article/slug'
import { renderRichTextEmbeds } from '@/lib/richtext/embeds'

type MdxProvider = {
  getPostBySlug: (slug: string, language: string) => Promise<Post | null>
}

export type GetPublicPostBySlugOptions = {
  mdx?: MdxProvider
  articleRepo?: Pick<ArticleRepo, 'findById' | 'findBySlug' | 'findBySlugAndLanguage'> | PublicArticleRepo
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

function safeDecodeURIComponent(input: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(input)) return input
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function uniqueNonEmpty(list: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const value = String(item ?? '')
    if (!value) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export async function getPublicPostBySlug(
  slug: string,
  language: string = 'zh',
  options?: GetPublicPostBySlugOptions
): Promise<PublicPost | null> {
  const raw = String(slug ?? '')
  const decoded = safeDecodeURIComponent(raw)
  const trimmed = decoded.trim()
  if (!trimmed) return null

  const mdx = options?.mdx ?? { getPostBySlug: getMdxPostBySlug }
  for (const candidate of uniqueNonEmpty([trimmed, raw.trim()])) {
    const mdxPost = await mdx.getPostBySlug(candidate, language).catch(() => null)
    if (mdxPost) return { source: 'mdx', post: mdxPost }
  }

  const repo = options?.articleRepo ?? (await getDefaultPublicArticleRepo())
  if (!repo) return null

  const id = extractArticleIdFromPostKey(trimmed)
  if (id && 'findById' in repo) {
    const found = await repo.findById(id).catch(() => null)
    if (found && found.status === 'published') {
      const sanitized = sanitizeRichTextHtml(found.contentHtml || '', { imageMode: 'progressive' })
      const contentHtml = renderRichTextEmbeds(sanitized, (found as any).contentJson)
      const isFallback = language !== 'zh' && found.language === 'zh'
      return { source: 'db', article: { ...found, contentHtml }, isFallback }
    }
  }

  for (const candidate of uniqueNonEmpty([decoded, trimmed, normalizeArticleSlug(decoded)])) {
    let article = null
    let isFallback = false

    if ('findBySlugAndLanguage' in repo && typeof repo.findBySlugAndLanguage === 'function') {
      article = await repo.findBySlugAndLanguage(candidate, language).catch(() => null)
      if (!article && language !== 'zh') {
        article = await repo.findBySlugAndLanguage(candidate, 'zh').catch(() => null)
        if (article) isFallback = true
      }
    } else {
      article = await repo.findBySlug(candidate).catch(() => null)
    }

    if (!article) continue
    if (article.status !== 'published') return null
    const sanitized = sanitizeRichTextHtml(article.contentHtml || '', { imageMode: 'progressive' })
    const contentHtml = renderRichTextEmbeds(sanitized, (article as any).contentJson)
    return { source: 'db', article: { ...article, contentHtml }, isFallback }
  }

  if (isFallbackHashSlug(trimmed) && hasListByStatus(repo)) {
    const published = await repo.listByStatus('published').catch(() => [])
    for (const a of published as any[]) {
      const title = String(a?.title || '')
      if (!title) continue
      const legacy = generateSlugFromTitle(title, new Date('2025-01-01T00:00:00.000Z'))
      if (legacy !== trimmed) continue
      if (a?.status !== 'published') continue
      const sanitized = sanitizeRichTextHtml(a.contentHtml || '', { imageMode: 'progressive' })
      const contentHtml = renderRichTextEmbeds(sanitized, (a as any).contentJson)
      const isFallback = language !== 'zh' && (a.language || 'zh') === 'zh'
      return { source: 'db', article: { ...a, contentHtml }, isFallback }
    }
  }

  return null
}
