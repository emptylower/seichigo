import type { ArticleRepo } from '@/lib/article/repo'
import { getDefaultPublicArticleRepo, type PublicArticleRepo } from '@/lib/posts/defaults'
import { normalizeArticleSlug } from '@/lib/article/slug'

type RepoWithFindBySlug = Pick<ArticleRepo, 'findBySlug'>

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

function hasFindBySlug(repo: unknown): repo is RepoWithFindBySlug {
  return typeof (repo as any)?.findBySlug === 'function'
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

export type GetDbArticleForPublicNoticeOptions = {
  articleRepo?: Pick<ArticleRepo, 'findById'> | PublicArticleRepo
}

export async function getDbArticleForPublicNotice(postKey: string, options?: GetDbArticleForPublicNoticeOptions) {
  const raw = String(postKey ?? '')
  const decoded = safeDecodeURIComponent(raw)
  const trimmed = decoded.trim()
  if (!trimmed) return null

  const id = extractArticleIdFromPostKey(trimmed)
  const repo = options?.articleRepo ?? (await getDefaultPublicArticleRepo())
  if (!repo) return null

  if (id && 'findById' in repo) {
    const found = await repo.findById(id).catch(() => null)
    if (found) return found
  }

  if (hasFindBySlug(repo)) {
    for (const candidate of uniqueNonEmpty([decoded, trimmed, normalizeArticleSlug(decoded)])) {
      const found = await repo.findBySlug(candidate).catch(() => null)
      if (found) return found
    }
  }

  return null
}
