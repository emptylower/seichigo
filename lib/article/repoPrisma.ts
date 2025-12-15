import { Prisma, type Article as PrismaArticle } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { ArticleSlugExistsError, type Article, type ArticleRepo, type CreateDraftInput, type UpdateDraftInput, type UpdateStateInput } from './repo'

function toArticle(record: PrismaArticle): Article {
  return {
    ...record,
    status: record.status as Article['status'],
  }
}

export class PrismaArticleRepo implements ArticleRepo {
  async createDraft(input: CreateDraftInput): Promise<Article> {
    try {
      const created = await prisma.article.create({
        data: {
          authorId: input.authorId,
          slug: input.slug,
          title: input.title,
          animeIds: input.animeIds ?? undefined,
          city: input.city ?? undefined,
          routeLength: input.routeLength ?? undefined,
          tags: input.tags ?? undefined,
          contentJson: input.contentJson ?? undefined,
          contentHtml: input.contentHtml ?? undefined,
        },
      })
      return toArticle(created)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ArticleSlugExistsError(input.slug)
      }
      throw err
    }
  }

  async findById(id: string): Promise<Article | null> {
    const found = await prisma.article.findUnique({ where: { id } })
    return found ? toArticle(found) : null
  }

  async findBySlug(slug: string): Promise<Article | null> {
    const found = await prisma.article.findUnique({ where: { slug } })
    return found ? toArticle(found) : null
  }

  async listByAuthor(authorId: string): Promise<Article[]> {
    const list = await prisma.article.findMany({ where: { authorId }, orderBy: { updatedAt: 'desc' } })
    return list.map(toArticle)
  }

  async listByStatus(status: Article['status']): Promise<Article[]> {
    const list = await prisma.article.findMany({ where: { status }, orderBy: { updatedAt: 'desc' } })
    return list.map(toArticle)
  }

  async updateDraft(id: string, input: UpdateDraftInput): Promise<Article | null> {
    try {
      const updated = await prisma.article.update({
        where: { id },
        data: {
          slug: input.slug ?? undefined,
          title: input.title ?? undefined,
          animeIds: input.animeIds === undefined ? undefined : input.animeIds,
          city: input.city === undefined ? undefined : input.city,
          routeLength: input.routeLength === undefined ? undefined : input.routeLength,
          tags: input.tags === undefined ? undefined : input.tags,
          contentJson: input.contentJson === undefined ? undefined : (input.contentJson as any),
          contentHtml: input.contentHtml === undefined ? undefined : input.contentHtml,
          needsRevision: input.needsRevision === undefined ? undefined : Boolean(input.needsRevision),
        },
      })
      return toArticle(updated)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return null
        if (err.code === 'P2002' && input.slug) throw new ArticleSlugExistsError(input.slug)
      }
      throw err
    }
  }

  async updateState(id: string, input: UpdateStateInput): Promise<Article | null> {
    try {
      const updated = await prisma.article.update({
        where: { id },
        data: {
          status: input.status ?? undefined,
          rejectReason: input.rejectReason === undefined ? undefined : input.rejectReason,
          needsRevision: input.needsRevision === undefined ? undefined : Boolean(input.needsRevision),
          publishedAt: input.publishedAt === undefined ? undefined : input.publishedAt,
        },
      })
      return toArticle(updated)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return null
      }
      throw err
    }
  }

  async delete(id: string): Promise<Article | null> {
    try {
      const deleted = await prisma.article.delete({ where: { id } })
      return toArticle(deleted)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return null
      }
      throw err
    }
  }
}
