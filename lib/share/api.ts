import type { Session } from 'next-auth'
import type { SupportedLocale } from '@/lib/i18n/types'
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
  /**
   * 建链成功后的卡片预热（两种版式各渲染一次，忽略结果）。
   * 可选：vitest 与 next dev 下不注入也能正常建链。
   */
  prewarmCard?: (input: { pointId: string; locale: SupportedLocale }) => Promise<unknown>
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
    prewarmCard: async ({ pointId, locale }) => {
      // 懒引：cardApi 会拖进 Browser Run 与镜像域，建链路径本身用不到
      const [{ getCardDeps }, { renderAndStoreCard }] = await Promise.all([
        import('@/lib/share/cardApi'),
        import('@/lib/share/handlers/card'),
      ])
      const cardDeps = await getCardDeps()
      await Promise.all(
        (['portrait', 'landscape'] as const).map((layout) =>
          renderAndStoreCard(cardDeps, { pointId, locale, layout, photoKey: null }),
        ),
      )
    },
  }

  return cached
}
