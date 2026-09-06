import { getMedia, getSchedule } from '@/app/(authed)/plan/[id]/components/itemPayload'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { getLocalizedDisplayName } from '@/lib/i18n/displayName'
import type { HomePopularAnimeItem } from '@/lib/home/types'
import type { TripPlanDayView } from '@/lib/tripPlan/view'

/** 首屏微演示迷你结果卡的一行：只保留标题、时间与一张缩略图 */
export type HeroDemoItem = {
  id: string
  title: string
  time: string | null
  image: string
}

/**
 * 微演示的数据只来自页面已有的展示计划：取 Day 1 的前 3 条**带图**条目。
 * 首屏不为演示额外请求任何东西，图片走 `/images/showcase/*.jpg` 这类公开路径。
 */
export function heroDemoItems(days: TripPlanDayView[] | undefined, limit = 3): HeroDemoItem[] {
  const items = days?.[0]?.items ?? []
  const out: HeroDemoItem[] = []
  for (const item of items) {
    const image = getMedia(item)?.displayUrl ?? item.point?.image ?? null
    if (!image) continue
    out.push({ id: item.id, title: item.title, time: getSchedule(item)?.start ?? null, image })
    if (out.length >= limit) break
  }
  return out
}

/**
 * 作品名滚动条的名单：热门作品的**当前语言显示名**（与作品卡同一套
 * `getLocalizedDisplayName`：ja 取日文原名、en 取英文名，缺失回退中文），
 * 不足 `min` 条时整轮重复补齐——CSS 无限滚动靠"轨道复制一份再平移一半"，
 * 名单太短会在宽屏上留出空白。
 */
export function heroWorkNames(
  popular: HomePopularAnimeItem[] | undefined,
  locale: SiteLocale,
  min = 8,
): string[] {
  const names = (popular ?? [])
    .map((item) => (item.anime ? getLocalizedDisplayName(item.anime, locale) : ''))
    .filter((name) => Boolean(name.trim()))
  if (!names.length) return []
  const out = [...names]
  while (out.length < min) out.push(...names)
  return out.slice(0, Math.max(min, names.length))
}
