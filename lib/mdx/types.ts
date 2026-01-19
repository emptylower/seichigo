export type TldrInfo = {
  duration?: string
  startPoint?: string
  endPoint?: string
  totalSpots?: number
  transport?: string
  estimatedCost?: string
}

export type TransportInfo = {
  icCard?: string
  lines?: string[]
  tips?: string[]
}

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

  tldr?: TldrInfo
  transportation?: TransportInfo
  photoTips?: string[]

  title_en?: string
  seoTitle_en?: string
  description_en?: string
}

export type Post = {
  frontmatter: PostFrontmatter
  content: React.ReactNode
}
