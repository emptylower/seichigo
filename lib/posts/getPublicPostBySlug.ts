import { cache } from 'react'
import type { Article, ArticleRepo } from '@/lib/article/repo'
import type { Post } from '@/lib/mdx/types'
import { getSnapshotPostBySlug } from '@/lib/mdx/publicSnapshot'
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
  articleRepo?: (
    Pick<ArticleRepo, 'findById' | 'findBySlug'> &
    Partial<Pick<ArticleRepo, 'findBySlugAndLanguage' | 'listByStatus'>>
  ) | PublicArticleRepo
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

type PublicPostRepo = NonNullable<GetPublicPostBySlugOptions['articleRepo']>

function toPublicDbPost(article: Article): PublicPost {
  const sanitized = sanitizeRichTextHtml(article.contentHtml || '', { imageMode: 'progressive' })
  const contentHtml = renderRichTextEmbeds(sanitized, article.contentJson)
  return { source: 'db', article: { ...article, contentHtml } }
}

async function loadPublicPostForLanguage(
  raw: string,
  decoded: string,
  trimmed: string,
  language: string,
  mdx: MdxProvider,
  repo: PublicPostRepo | null
): Promise<PublicPost | null> {
  for (const candidate of uniqueNonEmpty([trimmed, raw.trim()])) {
    const mdxPost = await mdx.getPostBySlug(candidate, language).catch(() => null)
    if (mdxPost) return { source: 'mdx', post: mdxPost }
  }

  if (!repo) return null

  const id = extractArticleIdFromPostKey(trimmed)
  if (id && 'findById' in repo) {
    const found = await repo.findById(id)
    if (found && String(found.language || 'zh') === language) {
      if (found.status !== 'published') return null
      return toPublicDbPost(found)
    }
  }

  for (const candidate of uniqueNonEmpty([decoded, trimmed, normalizeArticleSlug(decoded)])) {
    const article = 'findBySlugAndLanguage' in repo && typeof repo.findBySlugAndLanguage === 'function'
      ? await repo.findBySlugAndLanguage(candidate, language)
      : await repo.findBySlug(candidate)

    if (!article || String(article.language || 'zh') !== language) continue
    if (article.status !== 'published') return null
    return toPublicDbPost(article)
  }

  if (isFallbackHashSlug(trimmed) && hasListByStatus(repo)) {
    const published = await repo.listByStatus('published', language)
    for (const article of published) {
      if (String(article.language || 'zh') !== language) continue
      const title = String(article.title || '')
      if (!title) continue
      const legacy = generateSlugFromTitle(title, new Date('2025-01-01T00:00:00.000Z'))
      if (legacy !== trimmed) continue
      return toPublicDbPost(article)
    }
  }

  return null
}

async function loadPublicPostBySlug(
  slug: string,
  language: string = 'zh',
  options?: GetPublicPostBySlugOptions
): Promise<PublicPost | null> {
  const raw = String(slug ?? '')
  const decoded = safeDecodeURIComponent(raw)
  const trimmed = decoded.trim()
  if (!trimmed) return null

  const mdx = options?.mdx ?? { getPostBySlug: getSnapshotPostBySlug }
  const repo = options?.articleRepo ?? (await getDefaultPublicArticleRepo())
  const found = await loadPublicPostForLanguage(raw, decoded, trimmed, language, mdx, repo)
  if (found || language === 'zh') return found

  const fallback = await loadPublicPostForLanguage(raw, decoded, trimmed, 'zh', mdx, repo)
  if (fallback) {
    return { ...fallback, isFallback: true }
  }

  return null
}

const getCachedPublicPostBySlug = cache(async (slug: string, language: string) => {
  return loadPublicPostBySlug(slug, language)
})

export async function getPublicPostBySlug(
  slug: string,
  language: string = 'zh',
  options?: GetPublicPostBySlugOptions
): Promise<PublicPost | null> {
  if (options) return loadPublicPostBySlug(slug, language, options)
  return getCachedPublicPostBySlug(slug, language)
}
