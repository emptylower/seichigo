import type { Article, ArticleRepo } from '@/lib/article/repo'
import type { ArticleStatus } from '@/lib/article/workflow'

export type PublicArticleRepo = Pick<ArticleRepo, 'findById' | 'findBySlug' | 'findBySlugAndLanguage' | 'listByStatus'>

let cachedRepo: PublicArticleRepo | null | undefined

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((x) => String(x ?? '').trim()).filter(Boolean)
}

class PrismaPublicArticleRepo implements PublicArticleRepo {
  private normalizeArticle(record: any): Article {
    return {
      id: String(record?.id || ''),
      authorId: String(record?.authorId || ''),
      slug: String(record?.slug || ''),
      language: String(record?.language || 'zh'),
      translationGroupId: record?.translationGroupId ?? null,
      title: String(record?.title || ''),
      seoTitle: record?.seoTitle ?? null,
      description: record?.description ?? null,
      animeIds: normalizeStringArray(record?.animeIds),
      city: record?.city ?? null,
      routeLength: record?.routeLength ?? null,
      tags: normalizeStringArray(record?.tags),
      cover: record?.cover ?? null,
      contentJson: record?.contentJson ?? null,
      contentHtml: String(record?.contentHtml || ''),
      status: record?.status as ArticleStatus,
      rejectReason: record?.rejectReason ?? null,
      needsRevision: Boolean(record?.needsRevision),
      publishedAt: record?.publishedAt ?? null,
      lastApprovedAt: record?.lastApprovedAt ?? null,
      createdAt: record?.createdAt,
      updatedAt: record?.updatedAt,
    }
  }

  async findById(id: string): Promise<Article | null> {
    const { prisma } = await import('@/lib/db/prisma')
    const found = await prisma.article.findUnique({ where: { id } })
    return found ? this.normalizeArticle(found) : null
  }

  async findBySlug(slug: string): Promise<Article | null> {
    const { prisma } = await import('@/lib/db/prisma')
    const found = await prisma.article.findFirst({
      where: { slug, language: 'zh' },
      orderBy: { createdAt: 'asc' }
    })
    return found ? this.normalizeArticle(found) : null
  }

  async findBySlugAndLanguage(slug: string, language: string): Promise<Article | null> {
    const { prisma } = await import('@/lib/db/prisma')
    const found = await prisma.article.findUnique({
      where: { slug_language: { slug, language } }
    })
    return found ? this.normalizeArticle(found) : null
  }

  async listByStatus(status: ArticleStatus, language?: string): Promise<Article[]> {
    const { prisma } = await import('@/lib/db/prisma')
    const list = await prisma.article.findMany({
      where: { 
        status,
        ...(language && { language })
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        authorId: true,
        slug: true,
        language: true,
        translationGroupId: true,
        title: true,
        seoTitle: true,
        description: true,
        animeIds: true,
        city: true,
        routeLength: true,
        tags: true,
        cover: true,
        contentJson: true,
        status: true,
        rejectReason: true,
        needsRevision: true,
        publishedAt: true,
        lastApprovedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return list.map((r) => {
      return this.normalizeArticle({ ...r, contentHtml: '' })
    })
  }
}

export async function getDefaultPublicArticleRepo(): Promise<PublicArticleRepo | null> {
  if (cachedRepo !== undefined) return cachedRepo
  if (!process.env.DATABASE_URL) {
    cachedRepo = null
    return cachedRepo
  }
  cachedRepo = new PrismaPublicArticleRepo()
  return cachedRepo
}
