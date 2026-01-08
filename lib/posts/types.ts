import type { Article } from '@/lib/article/repo'
import type { Post } from '@/lib/mdx/types'

export type PublicPost = { source: 'mdx'; post: Post } | { source: 'db'; article: Article }

export type PublicPostListItem = {
  source: 'mdx' | 'db'
  path: string
  title: string
  animeIds: string[]
  city: string
  routeLength?: string
  tags: string[]
  cover?: string | null
  publishDate?: string
  publishedAt?: string
}
