import type { Article } from '@/lib/article/repo'
import type { Post } from '@/lib/mdx/types'

export type PublicPost = { source: 'mdx'; post: Post } | { source: 'db'; article: Article }

export type PublicPostListItem = {
  source: 'mdx' | 'db'
  slug: string
  title: string
  animeId: string
  city: string
  routeLength?: string
  tags: string[]
  publishDate?: string
  publishedAt?: string
}

