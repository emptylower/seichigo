import type { Session } from 'next-auth'
import type { UserPointStateRepo } from '@/lib/userPointState/repo'
import type { ShareLinkRepo } from '@/lib/share/repo'
import type { ShareStore } from '@/lib/share/store'

export type ShareApiDeps = {
  repo: ShareLinkRepo
  pointStateRepo: UserPointStateRepo
  /** 每次请求现取：R2 绑定挂在 per-request 的 cloudflare context 上 */
  getStore: () => ShareStore | null
  getSession: () => Promise<Session | null>
  now: () => Date
  /** 站点权威 origin，用于拼绝对短链与绝对 OG 图 URL */
  origin: string
}

let cached: ShareApiDeps | null = null

export async function getShareApiDeps(): Promise<ShareApiDeps> {
  if (cached) return cached

  const [{ PrismaShareLinkRepo }, { PrismaUserPointStateRepo }, { getShareStore }, { getServerAuthSession }, { getSiteOrigin }] =
    await Promise.all([
      import('@/lib/share/repoPrisma'),
      import('@/lib/userPointState/repoPrisma'),
      import('@/lib/share/store'),
      import('@/lib/auth/session'),
      import('@/lib/seo/site'),
    ])

  cached = {
    repo: new PrismaShareLinkRepo(),
    pointStateRepo: new PrismaUserPointStateRepo(),
    getStore: getShareStore,
    getSession: getServerAuthSession,
    now: () => new Date(),
    origin: getSiteOrigin(),
  }

  return cached
}
