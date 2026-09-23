/**
 * Google 地图导航链接：实现已迁至 `@/lib/route/navigationTargets`（与路线本共用），
 * 此处保留原导出名作 re-export，/plan 行为不变。
 */
export {
  buildDayNavigationUrls,
  buildPointNavigationUrl,
  defaultMaxNavigationWaypoints,
} from '@/lib/route/navigationTargets'
export type { NavigationPoint } from '@/lib/route/navigationTargets'
