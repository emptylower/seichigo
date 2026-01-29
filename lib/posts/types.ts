import type { Article } from '@/lib/article/repo'
import type { Post } from '@/lib/mdx/types'

export type PublicPost = 
  | { source: 'mdx'; post: Post; isFallback?: boolean }
  | { source: 'db'; article: Article; isFallback?: boolean }

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
  updatedAt?: string
}
