import type { Article } from '@/lib/article/repo'
import type { ArticleRevisionStatus } from './workflow'

export type ArticleSnapshot = Pick<
  Article,
  'id' | 'authorId' | 'title' | 'seoTitle' | 'description' | 'animeIds' | 'city' | 'routeLength' | 'tags' | 'cover' | 'contentJson' | 'contentHtml'
>

export type ArticleRevision = {
  id: string
  articleId: string
  authorId: string
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
  status: ArticleRevisionStatus
  rejectReason: string | null
  createdAt: Date
  updatedAt: Date
}

type MutableDraftFields =
  | 'title'
  | 'seoTitle'
  | 'description'
  | 'animeIds'
  | 'city'
  | 'routeLength'
  | 'tags'
  | 'cover'
  | 'contentJson'
  | 'contentHtml'

export type UpdateArticleRevisionDraftInput = Partial<Pick<ArticleRevision, MutableDraftFields>>

export type UpdateArticleRevisionStateInput = {
  status?: ArticleRevisionStatus
  rejectReason?: string | null
}

export interface ArticleRevisionRepo {
  findById(id: string): Promise<ArticleRevision | null>
  findActiveByArticleId(articleId: string): Promise<ArticleRevision | null>
  getOrCreateActiveFromArticle(article: ArticleSnapshot): Promise<ArticleRevision>
  listByAuthor(authorId: string): Promise<ArticleRevision[]>
  listByStatus(status: ArticleRevisionStatus): Promise<ArticleRevision[]>
  updateDraft(id: string, input: UpdateArticleRevisionDraftInput): Promise<ArticleRevision | null>
  updateState(id: string, input: UpdateArticleRevisionStateInput): Promise<ArticleRevision | null>
}
