import type { ArticleStatus } from './workflow'

export type Article = {
  id: string
  authorId: string
  slug: string
  language: string
  translationGroupId: string | null
  title: string
  seoTitle: string | null
  description: string | null
  animeIds: string[]
  city: string | null
  routeLength: string | null
  tags: string[]
  cover: string | null
  contentJson: unknown | null
  contentHtml: string
  status: ArticleStatus
  rejectReason: string | null
  needsRevision: boolean
  publishedAt: Date | null
  lastApprovedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type CreateDraftInput = {
  authorId: string
  slug: string
  language?: string
  translationGroupId?: string | null
  title: string
  seoTitle?: string | null
  description?: string | null
  animeIds?: string[]
  city?: string | null
  routeLength?: string | null
  tags?: string[]
  cover?: string | null
  contentJson?: unknown | null
  contentHtml?: string
}

export type UpdateDraftInput = Partial<Omit<CreateDraftInput, 'authorId'>> & {
  needsRevision?: boolean
}

export type UpdateStateInput = {
  status?: ArticleStatus
  rejectReason?: string | null
  needsRevision?: boolean
  publishedAt?: Date | null
  lastApprovedAt?: Date | null
}

export interface ArticleRepo {
  createDraft(input: CreateDraftInput): Promise<Article>
  findById(id: string): Promise<Article | null>
  findBySlug(slug: string): Promise<Article | null>
  findBySlugAndLanguage(slug: string, language: string): Promise<Article | null>
  listByAuthor(authorId: string): Promise<Article[]>
  listByStatus(status: ArticleStatus): Promise<Article[]>
  updateDraft(id: string, input: UpdateDraftInput): Promise<Article | null>
  updateState(id: string, input: UpdateStateInput): Promise<Article | null>
  delete(id: string): Promise<Article | null>
}

export class ArticleSlugExistsError extends Error {
  readonly slug: string

  constructor(slug: string) {
    super('Article slug already exists')
    this.name = 'ArticleSlugExistsError'
    this.slug = slug
  }
}
