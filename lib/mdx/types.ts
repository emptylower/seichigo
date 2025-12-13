export type PostFrontmatter = {
  title: string
  slug: string
  animeId: string
  city: string
  routeLength?: string
  language?: string
  tags?: string[]
  publishDate?: string
  updatedDate?: string
  status?: 'published' | 'draft'
}

export type Post = {
  frontmatter: PostFrontmatter
  content: React.ReactNode
}

