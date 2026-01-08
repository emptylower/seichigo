import type { ArticleRepo } from '@/lib/article/repo'
import { getDefaultPublicArticleRepo, type PublicArticleRepo } from '@/lib/posts/defaults'

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

export type GetDbArticleForPublicNoticeOptions = {
  articleRepo?: Pick<ArticleRepo, 'findById'> | PublicArticleRepo
}

export async function getDbArticleForPublicNotice(postKey: string, options?: GetDbArticleForPublicNoticeOptions) {
  const target = postKey.trim()
  if (!target) return null

  const id = extractArticleIdFromPostKey(target)
  const repo = options?.articleRepo ?? (await getDefaultPublicArticleRepo())
  if (!repo) return null

  if (id && 'findById' in repo) {
    const found = await repo.findById(id).catch(() => null)
    if (found) return found
  }

  if ('findBySlug' in repo) {
    return await repo.findBySlug(target).catch(() => null)
  }

  return null
}
