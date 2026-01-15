import crypto from 'node:crypto'
import type {
  ArticleRevision,
  ArticleRevisionRepo,
  ArticleSnapshot,
  UpdateArticleRevisionDraftInput,
  UpdateArticleRevisionStateInput,
} from './repo'

type Options = {
  now?: () => Date
  idFactory?: () => string
}

function isActiveStatus(status: ArticleRevision['status']): boolean {
  return status === 'draft' || status === 'in_review' || status === 'rejected'
}

export class InMemoryArticleRevisionRepo implements ArticleRevisionRepo {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly byId = new Map<string, ArticleRevision>()
  private readonly activeByArticleId = new Map<string, string>()

  constructor(options?: Options) {
    this.now = options?.now ?? (() => new Date())
    this.idFactory = options?.idFactory ?? (() => crypto.randomUUID())
  }

  async findById(id: string): Promise<ArticleRevision | null> {
    return this.byId.get(id) ?? null
  }

  async findActiveByArticleId(articleId: string): Promise<ArticleRevision | null> {
    const activeId = this.activeByArticleId.get(articleId)
    if (!activeId) return null
    const revision = this.byId.get(activeId) ?? null
    if (!revision) {
      this.activeByArticleId.delete(articleId)
      return null
    }
    if (!isActiveStatus(revision.status)) {
      this.activeByArticleId.delete(articleId)
      return null
    }
    return revision
  }

  async getOrCreateActiveFromArticle(article: ArticleSnapshot): Promise<ArticleRevision> {
    const existing = await this.findActiveByArticleId(article.id)
    if (existing) return existing

    const now = this.now()
    const revision: ArticleRevision = {
      id: this.idFactory(),
      articleId: article.id,
      authorId: article.authorId,
      title: article.title,
      seoTitle: article.seoTitle ?? null,
      description: article.description ?? null,
      animeIds: Array.isArray(article.animeIds) ? [...article.animeIds] : [],
      city: article.city ?? null,
      routeLength: article.routeLength ?? null,
      tags: Array.isArray(article.tags) ? [...article.tags] : [],
      cover: article.cover ?? null,
      contentJson: article.contentJson ?? null,
      contentHtml: article.contentHtml ?? '',
      status: 'draft',
      rejectReason: null,
      createdAt: now,
      updatedAt: now,
    }

    this.byId.set(revision.id, revision)
    this.activeByArticleId.set(article.id, revision.id)
    return revision
  }

  async listByAuthor(authorId: string): Promise<ArticleRevision[]> {
    return Array.from(this.byId.values())
      .filter((r) => r.authorId === authorId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  async listByStatus(status: ArticleRevision['status']): Promise<ArticleRevision[]> {
    return Array.from(this.byId.values())
      .filter((r) => r.status === status)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  async updateDraft(id: string, input: UpdateArticleRevisionDraftInput): Promise<ArticleRevision | null> {
    const existing = this.byId.get(id)
    if (!existing) return null

    if (input.title != null) existing.title = input.title
    if (input.seoTitle !== undefined) existing.seoTitle = input.seoTitle ?? null
    if (input.description !== undefined) existing.description = input.description ?? null
    if (input.animeIds !== undefined) existing.animeIds = input.animeIds ?? []
    if (input.city !== undefined) existing.city = input.city ?? null
    if (input.routeLength !== undefined) existing.routeLength = input.routeLength ?? null
    if (input.tags !== undefined) existing.tags = input.tags ?? []
    if (input.cover !== undefined) existing.cover = input.cover ?? null
    if (input.contentJson !== undefined) existing.contentJson = input.contentJson ?? null
    if (input.contentHtml !== undefined) existing.contentHtml = input.contentHtml ?? ''

    existing.updatedAt = this.now()
    this.byId.set(id, { ...existing })
    return this.byId.get(id) ?? null
  }

  async updateState(id: string, input: UpdateArticleRevisionStateInput): Promise<ArticleRevision | null> {
    const existing = this.byId.get(id)
    if (!existing) return null

    if (input.status != null) existing.status = input.status
    if (input.rejectReason !== undefined) existing.rejectReason = input.rejectReason ?? null

    existing.updatedAt = this.now()
    this.byId.set(id, { ...existing })

    if (!isActiveStatus(existing.status)) {
      if (this.activeByArticleId.get(existing.articleId) === existing.id) {
        this.activeByArticleId.delete(existing.articleId)
      }
    } else {
      const other = this.activeByArticleId.get(existing.articleId)
      if (other && other !== existing.id) {
        throw new Error('active revision already exists for article')
      }
      this.activeByArticleId.set(existing.articleId, existing.id)
    }

    return this.byId.get(id) ?? null
  }
}
