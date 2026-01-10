import type { Session } from 'next-auth'
import type { ArticleRepo } from '@/lib/article/repo'
import type { ArticleRevisionRepo } from '@/lib/articleRevision/repo'

export type ArticleRevisionApiDeps = {
  articleRepo: ArticleRepo
  revisionRepo: ArticleRevisionRepo
  getSession: () => Promise<Session | null>
  sanitizeHtml: (html: string) => string
  now: () => Date
}

let cached: ArticleRevisionApiDeps | null = null

export async function getArticleRevisionApiDeps(): Promise<ArticleRevisionApiDeps> {
  if (cached) return cached

  const [{ PrismaArticleRepo }, { PrismaArticleRevisionRepo }, { getServerAuthSession }, { sanitizeRichTextHtml }] = await Promise.all([
    import('@/lib/article/repoPrisma'),
    import('@/lib/articleRevision/repoPrisma'),
    import('@/lib/auth/session'),
    import('@/lib/richtext/sanitize'),
  ])

  cached = {
    articleRepo: new PrismaArticleRepo(),
    revisionRepo: new PrismaArticleRevisionRepo(),
    getSession: getServerAuthSession,
    sanitizeHtml: sanitizeRichTextHtml,
    now: () => new Date(),
  }
  return cached
}
