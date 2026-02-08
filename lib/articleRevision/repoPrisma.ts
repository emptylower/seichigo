import { Prisma, type ArticleRevision as PrismaArticleRevision } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type {
  ArticleRevision,
  ArticleRevisionSummary,
  ArticleRevisionRepo,
  ArticleSnapshot,
  UpdateArticleRevisionDraftInput,
  UpdateArticleRevisionStateInput,
} from './repo'

const ACTIVE_KEY = 'active'

function toRevision(record: PrismaArticleRevision): ArticleRevision {
  return {
    ...record,
    status: record.status as ArticleRevision['status'],
    language: record.language,
    translationGroupId: record.translationGroupId,
  }
}

function toRevisionSummary(
  record: Pick<PrismaArticleRevision, 'id' | 'articleId' | 'authorId' | 'language' | 'translationGroupId' | 'title' | 'status' | 'createdAt' | 'updatedAt'>
): ArticleRevisionSummary {
  return {
    id: record.id,
    articleId: record.articleId,
    authorId: record.authorId,
    language: record.language,
    translationGroupId: record.translationGroupId,
    title: record.title,
    status: record.status as ArticleRevision['status'],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function isActiveStatus(status: ArticleRevision['status']): boolean {
  return status === 'draft' || status === 'in_review' || status === 'rejected'
}

export class PrismaArticleRevisionRepo implements ArticleRevisionRepo {
  async findById(id: string): Promise<ArticleRevision | null> {
    const found = await prisma.articleRevision.findUnique({ where: { id } })
    return found ? toRevision(found) : null
  }

  async findActiveByArticleId(articleId: string): Promise<ArticleRevision | null> {
    const found = await prisma.articleRevision.findUnique({
      where: { articleId_activeKey: { articleId, activeKey: ACTIVE_KEY } },
    })
    return found ? toRevision(found) : null
  }

  async getOrCreateActiveFromArticle(article: ArticleSnapshot): Promise<ArticleRevision> {
    const existing = await this.findActiveByArticleId(article.id)
    if (existing) return existing

    try {
      const created = await prisma.articleRevision.create({
        data: {
          articleId: article.id,
          authorId: article.authorId,
          language: article.language ?? 'zh',
          translationGroupId: article.translationGroupId ?? undefined,
          title: article.title,
          seoTitle: article.seoTitle ?? undefined,
          description: article.description ?? undefined,
          animeIds: article.animeIds ?? undefined,
          city: article.city ?? undefined,
          routeLength: article.routeLength ?? undefined,
          tags: article.tags ?? undefined,
          cover: article.cover ?? undefined,
          contentJson: article.contentJson ?? undefined,
          contentHtml: article.contentHtml ?? undefined,
          status: 'draft',
          activeKey: ACTIVE_KEY,
          rejectReason: null,
        },
      })
      return toRevision(created)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const conflict = await this.findActiveByArticleId(article.id)
        if (conflict) return conflict
      }
      throw err
    }
  }

  async listByAuthor(authorId: string): Promise<ArticleRevision[]> {
    const list = await prisma.articleRevision.findMany({ where: { authorId }, orderBy: { updatedAt: 'desc' } })
    return list.map(toRevision)
  }

  async listByStatus(status: ArticleRevision['status']): Promise<ArticleRevision[]> {
    const list = await prisma.articleRevision.findMany({ where: { status }, orderBy: { updatedAt: 'desc' } })
    return list.map(toRevision)
  }

  async listSummaryByStatus(status: ArticleRevision['status']): Promise<ArticleRevisionSummary[]> {
    const list = await prisma.articleRevision.findMany({
      where: { status },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        articleId: true,
        authorId: true,
        language: true,
        translationGroupId: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return list.map(toRevisionSummary)
  }

  async updateDraft(id: string, input: UpdateArticleRevisionDraftInput): Promise<ArticleRevision | null> {
    try {
      const updated = await prisma.articleRevision.update({
        where: { id },
        data: {
          title: input.title ?? undefined,
          seoTitle: input.seoTitle === undefined ? undefined : input.seoTitle,
          description: input.description === undefined ? undefined : input.description,
          animeIds: input.animeIds === undefined ? undefined : input.animeIds,
          city: input.city === undefined ? undefined : input.city,
          routeLength: input.routeLength === undefined ? undefined : input.routeLength,
          tags: input.tags === undefined ? undefined : input.tags,
          cover: input.cover === undefined ? undefined : input.cover,
          contentJson: input.contentJson === undefined ? undefined : (input.contentJson as any),
          contentHtml: input.contentHtml === undefined ? undefined : input.contentHtml,
        },
      })
      return toRevision(updated)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return null
      }
      throw err
    }
  }

  async updateState(id: string, input: UpdateArticleRevisionStateInput): Promise<ArticleRevision | null> {
    try {
      const data: Record<string, any> = {}
      if (input.status !== undefined) {
        data.status = input.status
        data.activeKey = isActiveStatus(input.status) ? ACTIVE_KEY : null
      }
      if (input.rejectReason !== undefined) {
        data.rejectReason = input.rejectReason
      }

      const updated = await prisma.articleRevision.update({
        where: { id },
        data,
      })
      return toRevision(updated)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return null
      }
      throw err
    }
  }
}
