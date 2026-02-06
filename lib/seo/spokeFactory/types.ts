export type SpokeLocale = 'zh' | 'en' | 'ja'
export type SpokeMode = 'preview' | 'generate'
export type SpokeScope = 'all'

export type SpokeSourcePost = {
  path: string
  title: string
  city: string
  animeIds: string[]
  tags: string[]
}

export type SpokeCandidate = {
  canonicalPlaceKey: string
  placeName: string
  animeId: string
  city: string
  slugBase: string
  reason: string
  confidence: number
  sourcePaths: string[]
}

export type SpokeSelectedTopic = {
  canonicalPlaceKey: string
  placeName: string
  animeId: string
  city: string
  slug: string
  reason: string
  confidence: number
  sourcePaths: string[]
}

export type SpokeFrontmatter = {
  title: string
  seoTitle: string
  description: string
  slug: string
  animeId: string
  city: string
  language: SpokeLocale
  tags: string[]
  publishDate: string
  status: 'published'
  canonicalPlaceKey: string
}

export type SpokeGeneratedDoc = {
  locale: SpokeLocale
  slug: string
  path: string
  frontmatter: SpokeFrontmatter
  content: string
  rawMdx: string
}

export type SpokeFactoryInput = {
  mode: SpokeMode
  locales: SpokeLocale[]
  scope: SpokeScope
  maxTopics: number
}

export type SpokeFactorySummary = {
  mode: SpokeMode
  sourcePostCount: number
  candidateCount: number
  selectedTopics: number
  generatedFiles: number
  skippedExisting: number
  skippedLowConfidence: number
  skipped: Array<{ reason: string; value: string }>
  errors: string[]
  topics: SpokeSelectedTopic[]
  files: Array<{ path: string; locale: SpokeLocale; slug: string }>
  prUrl: string | null
}

export function isSpokeLocale(value: string): value is SpokeLocale {
  return value === 'zh' || value === 'en' || value === 'ja'
}

export function isSpokeMode(value: string): value is SpokeMode {
  return value === 'preview' || value === 'generate'
}
