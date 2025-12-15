import crypto from 'node:crypto'
import { ArticleSlugExistsError, type Article, type ArticleRepo, type CreateDraftInput, type UpdateDraftInput, type UpdateStateInput } from './repo'

type Options = {
  now?: () => Date
  idFactory?: () => string
}

export class InMemoryArticleRepo implements ArticleRepo {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly byId = new Map<string, Article>()
  private readonly bySlug = new Map<string, string>() // slug -> id

  constructor(options?: Options) {
    this.now = options?.now ?? (() => new Date())
    this.idFactory = options?.idFactory ?? (() => crypto.randomUUID())
  }

  async createDraft(input: CreateDraftInput): Promise<Article> {
    const slug = input.slug.trim()
    if (!slug) throw new Error('slug is required')
    if (this.bySlug.has(slug)) throw new ArticleSlugExistsError(slug)

    const now = this.now()
    const article: Article = {
      id: this.idFactory(),
      authorId: input.authorId,
      slug,
      title: input.title,
      animeIds: input.animeIds ?? [],
      city: input.city ?? null,
      routeLength: input.routeLength ?? null,
      tags: input.tags ?? [],
      contentJson: input.contentJson ?? null,
      contentHtml: input.contentHtml ?? '',
      status: 'draft',
      rejectReason: null,
      needsRevision: false,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    this.byId.set(article.id, article)
    this.bySlug.set(article.slug, article.id)
    return article
  }

  async findById(id: string): Promise<Article | null> {
    return this.byId.get(id) ?? null
  }

  async findBySlug(slug: string): Promise<Article | null> {
    const id = this.bySlug.get(slug)
    if (!id) return null
    return this.byId.get(id) ?? null
  }

  async listByAuthor(authorId: string): Promise<Article[]> {
    return Array.from(this.byId.values())
      .filter((a) => a.authorId === authorId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  async listByStatus(status: Article['status']): Promise<Article[]> {
    return Array.from(this.byId.values())
      .filter((a) => a.status === status)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  async updateDraft(id: string, input: UpdateDraftInput): Promise<Article | null> {
    const existing = this.byId.get(id)
    if (!existing) return null

    if (input.slug != null) {
      const nextSlug = input.slug.trim()
      if (!nextSlug) throw new Error('slug is required')
      const slugOwner = this.bySlug.get(nextSlug)
      if (slugOwner && slugOwner !== id) throw new ArticleSlugExistsError(nextSlug)
      if (nextSlug !== existing.slug) {
        this.bySlug.delete(existing.slug)
        this.bySlug.set(nextSlug, id)
      }
      existing.slug = nextSlug
    }

    if (input.title != null) existing.title = input.title
    if (input.animeIds !== undefined) existing.animeIds = input.animeIds ?? []
    if (input.city !== undefined) existing.city = input.city ?? null
    if (input.routeLength !== undefined) existing.routeLength = input.routeLength ?? null
    if (input.tags !== undefined) existing.tags = input.tags ?? []
    if (input.contentJson !== undefined) existing.contentJson = input.contentJson ?? null
    if (input.contentHtml !== undefined) existing.contentHtml = input.contentHtml ?? ''
    if (input.needsRevision !== undefined) existing.needsRevision = Boolean(input.needsRevision)

    existing.updatedAt = this.now()
    this.byId.set(id, { ...existing })
    return this.byId.get(id) ?? null
  }

  async updateState(id: string, input: UpdateStateInput): Promise<Article | null> {
    const existing = this.byId.get(id)
    if (!existing) return null

    if (input.status != null) existing.status = input.status
    if (input.rejectReason !== undefined) existing.rejectReason = input.rejectReason ?? null
    if (input.needsRevision !== undefined) existing.needsRevision = Boolean(input.needsRevision)
    if (input.publishedAt !== undefined) existing.publishedAt = input.publishedAt ?? null

    existing.updatedAt = this.now()
    this.byId.set(id, { ...existing })
    return this.byId.get(id) ?? null
  }

  async delete(id: string): Promise<Article | null> {
    const existing = this.byId.get(id)
    if (!existing) return null

    this.byId.delete(id)
    if (this.bySlug.get(existing.slug) === id) {
      this.bySlug.delete(existing.slug)
    }
    return existing
  }
}
