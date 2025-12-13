import type { Session } from 'next-auth'
import type { ArticleRepo } from '@/lib/article/repo'
import { mdxSlugExists } from '@/lib/mdx/slugExists'

export type ArticleApiDeps = {
  repo: ArticleRepo
  getSession: () => Promise<Session | null>
  mdxSlugExists: (slug: string) => Promise<boolean>
  sanitizeHtml: (html: string) => string
  now: () => Date
}

let cached: ArticleApiDeps | null = null

export async function getArticleApiDeps(): Promise<ArticleApiDeps> {
  if (cached) return cached

  const [{ PrismaArticleRepo }, { getServerAuthSession }, { sanitizeRichTextHtml }] = await Promise.all([
    import('@/lib/article/repoPrisma'),
    import('@/lib/auth/session'),
    import('@/lib/richtext/sanitize'),
  ])

  cached = {
    repo: new PrismaArticleRepo(),
    getSession: getServerAuthSession,
    mdxSlugExists: (slug) => mdxSlugExists(slug, 'zh'),
    sanitizeHtml: sanitizeRichTextHtml,
    now: () => new Date(),
  }
  return cached
}
