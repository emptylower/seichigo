import type { PublicPostListItem } from '@/lib/posts/types'
import { getAllPublicPosts, type GetAllPublicPostsOptions } from '@/lib/posts/getAllPublicPosts'

function safeDecodeURIComponent(input: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(input)) return input
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

export async function getPostsByAnimeId(
  animeId: string,
  language: string = 'zh',
  options?: GetAllPublicPostsOptions
): Promise<PublicPostListItem[]> {
  const raw = String(animeId ?? '')
  const decoded = safeDecodeURIComponent(raw)
  const id = decoded.trim()
  if (!id) return []
  const all = await getAllPublicPosts(language, options)
  return all.filter((p) => (p.animeIds || []).includes(id))
}
