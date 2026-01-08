export type PostFrontmatter = {
  title: string
  seoTitle?: string
  description?: string
  slug: string
  animeId: string
  city: string
  areas?: string[]
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
