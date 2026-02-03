import type { Session } from 'next-auth'
import type { ArticleRepo } from '@/lib/article/repo'

export type AiApiDeps = {
  repo: ArticleRepo
  getSession: () => Promise<Session | null>
  sanitizeHtml: (html: string) => string
  isAdminEmail: (email?: string | null) => boolean
}

let cached: AiApiDeps | null = null

export async function getAiApiDeps(): Promise<AiApiDeps> {
  if (cached) return cached

  const [{ PrismaArticleRepo }, { getServerAuthSession }, { sanitizeRichTextHtml }, { isAdminEmail }] =
    await Promise.all([
      import('@/lib/article/repoPrisma'),
      import('@/lib/auth/session'),
      import('@/lib/richtext/sanitize'),
      import('@/lib/auth/admin'),
    ])

  cached = {
    repo: new PrismaArticleRepo(),
    getSession: getServerAuthSession,
    sanitizeHtml: sanitizeRichTextHtml,
    isAdminEmail,
  }
  return cached
}
