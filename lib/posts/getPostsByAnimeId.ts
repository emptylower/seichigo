import type { PublicPostListItem } from '@/lib/posts/types'
import { getAllPublicPosts, type GetAllPublicPostsOptions } from '@/lib/posts/getAllPublicPosts'

export async function getPostsByAnimeId(
  animeId: string,
  language: string = 'zh',
  options?: GetAllPublicPostsOptions
): Promise<PublicPostListItem[]> {
  const id = animeId.trim()
  if (!id) return []
  const all = await getAllPublicPosts(language, options)
  return all.filter((p) => (p.animeIds || []).includes(id))
}

