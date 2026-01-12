import type { Session } from 'next-auth'
import type { ArticleRepo } from '@/lib/article/repo'
import type { PostFrontmatter } from '@/lib/mdx/types'
import type { FavoriteRepo } from './repo'

export type FavoriteApiDeps = {
  repo: FavoriteRepo
  articleRepo: Pick<ArticleRepo, 'findById'>
  getSession: () => Promise<Session | null>
  mdx: {
    getAllPosts: (language: string) => Promise<PostFrontmatter[]>
  }
  language: string
}

let cached: FavoriteApiDeps | null = null

export async function getFavoriteApiDeps(): Promise<FavoriteApiDeps> {
  if (cached) return cached

  const [{ PrismaFavoriteRepo }, { PrismaArticleRepo }, { getServerAuthSession }, { getAllPosts }] = await Promise.all([
    import('@/lib/favorite/repoPrisma'),
    import('@/lib/article/repoPrisma'),
    import('@/lib/auth/session'),
    import('@/lib/mdx/getAllPosts'),
  ])

  cached = {
    repo: new PrismaFavoriteRepo(),
    articleRepo: new PrismaArticleRepo(),
    getSession: getServerAuthSession,
    mdx: { getAllPosts },
    language: 'zh',
  }
  return cached
}

