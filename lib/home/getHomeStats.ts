import { unstable_cache } from 'next/cache'
import { listCitiesForIndex } from '@/lib/city/db'
import { prisma } from '@/lib/db/prisma'
import type { SupportedLocale } from '@/lib/i18n/types'
import { getAllPublicPostsForHome } from '@/lib/posts/getAllPublicPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'
import type { PublicPostListItem } from '@/lib/posts/types'
import { HomeDataSourceError } from './dataSourceError'
import type { HomeStats } from './types'

/**
 * 首页四格计数的数据源集合。注入式依赖与 getCityCountsByLocale 同风格：
 * 测试注入内存源，默认源走 Prisma 单例。
 */
export type HomeStatsDeps = {
  countPoints: () => Promise<number>
  countWorks: () => Promise<number>
  listCities: () => Promise<unknown[]>
  loadPublicPosts: () => Promise<PublicPostListItem[]>
}

/**
 * 点位口径与首页地图聚合（home-map-clusters.json 的 totalPoints）一致：
 * 只数 geoLat/geoLng 都非空的点位，缺坐标的点位首页两处都不展示。
 */
export const HOME_STATS_POINT_WHERE = {
  geoLat: { not: null },
  geoLng: { not: null },
} as const

export function defaultHomeStatsDeps(locale: SupportedLocale = 'zh'): HomeStatsDeps {
  return {
    countPoints: () => prisma.anitabiPoint.count({ where: HOME_STATS_POINT_WHERE }),
    countWorks: () => prisma.anitabiBangumi.count({ where: { mapEnabled: true } }),
    listCities: listCitiesForIndex,
    loadPublicPosts: () => getAllPublicPostsForHome(locale),
  }
}

async function loadCounter(source: string, load: () => Promise<number>): Promise<number> {
  try {
    return await load()
  } catch (reason) {
    throw new HomeDataSourceError(`home.stats.${source}`, 'failure', reason)
  }
}

/**
 * 任一计数失败即抛错（不降级缓存空值）——与 getHomePortalData 同口径：
 * 缺任何一个数字都比显示错误的数字好。
 */
export async function computeHomeStats(deps: Partial<HomeStatsDeps> = {}): Promise<HomeStats> {
  const effective = { ...defaultHomeStatsDeps(), ...deps }
  const [points, works, cities, posts] = await Promise.all([
    loadCounter('points', effective.countPoints),
    loadCounter('works', effective.countWorks),
    loadCounter('cities', async () => (await effective.listCities()).length),
    loadCounter('posts', async () => {
      const posts = await effective.loadPublicPosts()
      return posts.filter((post) => !isSeoSpokePost(post)).length
    }),
  ])
  return { points, works, cities, posts }
}

const getCachedHomeStats = unstable_cache(
  async (locale: SupportedLocale) => computeHomeStats(defaultHomeStatsDeps(locale)),
  ['home:getHomeStats'],
  { revalidate: 600 }
)

/**
 * 首页计数聚合，unstable_cache 600s（locale 参与缓存键：文章数按 locale 计）；
 * 注入 deps 时直算（测试/脚本用）。
 */
export async function getHomeStats(
  locale: SupportedLocale = 'zh',
  deps?: Partial<HomeStatsDeps>
): Promise<HomeStats> {
  if (deps) return computeHomeStats(deps)
  return getCachedHomeStats(locale)
}
