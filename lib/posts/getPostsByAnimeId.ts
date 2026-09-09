import type { PublicPostListItem } from '@/lib/posts/types'
import { getAllPublicPosts, type GetAllPublicPostsOptions } from '@/lib/posts/getAllPublicPosts'
import { fullyDecodeURIComponent } from '@/lib/url/decode'

export async function getPostsByAnimeId(
  animeId: string,
  language: string = 'zh',
  options?: GetAllPublicPostsOptions
): Promise<PublicPostListItem[]> {
  const raw = String(animeId ?? '')
  const decoded = fullyDecodeURIComponent(raw)
  const id = decoded.trim()
  if (!id) return []
  const all = await getAllPublicPosts(language, options)
  return all.filter((p) => (p.animeIds || []).includes(id))
}
