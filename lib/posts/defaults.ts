import type { ArticleRepo } from '@/lib/article/repo'

export type PublicArticleRepo = Pick<ArticleRepo, 'findBySlug' | 'listByStatus'>

let cachedRepo: PublicArticleRepo | null | undefined

export async function getDefaultPublicArticleRepo(): Promise<PublicArticleRepo | null> {
  if (cachedRepo !== undefined) return cachedRepo
  if (!process.env.DATABASE_URL) {
    cachedRepo = null
    return cachedRepo
  }
  const { PrismaArticleRepo } = await import('@/lib/article/repoPrisma')
  cachedRepo = new PrismaArticleRepo()
  return cachedRepo
}

