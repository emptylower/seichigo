import type { ArticleRepo } from '@/lib/article/repo'
import { getDefaultPublicArticleRepo, type PublicArticleRepo } from '@/lib/posts/defaults'

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

export type GetDbArticleForPublicNoticeOptions = {
  articleRepo?: Pick<ArticleRepo, 'findById'> | PublicArticleRepo
}

export async function getDbArticleForPublicNotice(postKey: string, options?: GetDbArticleForPublicNoticeOptions) {
  const target = postKey.trim()
  if (!target) return null

  const id = extractArticleIdFromPostKey(target)
  if (!id) return null

  const repo = options?.articleRepo ?? (await getDefaultPublicArticleRepo())
  if (!repo || !('findById' in repo)) return null

  const found = await repo.findById(id).catch(() => null)
  return found
}

