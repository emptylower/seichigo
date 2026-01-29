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
  private readonly bySlugLang = new Map<string, string>() // `${slug}:${language}` -> id

  constructor(options?: Options) {
    this.now = options?.now ?? (() => new Date())
    this.idFactory = options?.idFactory ?? (() => crypto.randomUUID())
  }

  private slugLangKey(slug: string, language: string): string {
    return `${slug}:${language}`
  }

  async createDraft(input: CreateDraftInput): Promise<Article> {
    const slug = input.slug.trim()
    if (!slug) throw new Error('slug is required')
    const language = input.language ?? 'zh'
    const key = this.slugLangKey(slug, language)
    if (this.bySlugLang.has(key)) throw new ArticleSlugExistsError(slug)

    const now = this.now()
    const article: Article = {
      id: this.idFactory(),
      authorId: input.authorId,
      slug,
      language,
      translationGroupId: input.translationGroupId ?? null,
      title: input.title,
      seoTitle: input.seoTitle ?? null,
      description: input.description ?? null,
      animeIds: input.animeIds ?? [],
      city: input.city ?? null,
      routeLength: input.routeLength ?? null,
      tags: input.tags ?? [],
      cover: input.cover ?? null,
      contentJson: input.contentJson ?? null,
      contentHtml: input.contentHtml ?? '',
      status: 'draft',
      rejectReason: null,
      needsRevision: false,
      publishedAt: null,
      lastApprovedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    this.byId.set(article.id, article)
    this.bySlugLang.set(key, article.id)
    return article
  }

  async findById(id: string): Promise<Article | null> {
    return this.byId.get(id) ?? null
  }

  async findBySlug(slug: string): Promise<Article | null> {
    const key = this.slugLangKey(slug, 'zh')
    const id = this.bySlugLang.get(key)
    if (!id) return null
    return this.byId.get(id) ?? null
  }

  async findBySlugAndLanguage(slug: string, language: string): Promise<Article | null> {
    const key = this.slugLangKey(slug, language)
    const id = this.bySlugLang.get(key)
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
      const oldKey = this.slugLangKey(existing.slug, existing.language)
      const newKey = this.slugLangKey(nextSlug, existing.language)
      const slugOwner = this.bySlugLang.get(newKey)
      if (slugOwner && slugOwner !== id) throw new ArticleSlugExistsError(nextSlug)
      if (nextSlug !== existing.slug) {
        this.bySlugLang.delete(oldKey)
        this.bySlugLang.set(newKey, id)
      }
      existing.slug = nextSlug
    }

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
    if (input.lastApprovedAt !== undefined) existing.lastApprovedAt = input.lastApprovedAt ?? null

    existing.updatedAt = this.now()
    this.byId.set(id, { ...existing })
    return this.byId.get(id) ?? null
  }

  async delete(id: string): Promise<Article | null> {
    const existing = this.byId.get(id)
    if (!existing) return null

    this.byId.delete(id)
    const key = this.slugLangKey(existing.slug, existing.language)
    if (this.bySlugLang.get(key) === id) {
      this.bySlugLang.delete(key)
    }
    return existing
  }
}
