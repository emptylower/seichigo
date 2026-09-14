import type { SiteLocale } from '@/components/layout/SiteShell'
import { prefixPath } from '@/components/layout/prefixPath'

/**
 * 起始页 `/plan/start` 是三语本地化路由（`prefixPath` 里的精确例外）：语言由
 * 路径携带（/plan/start、/en/plan/start、/ja/plan/start），draft 用 query 带
 * 过去，不再使用 `?locale=`。
 */
export function planStartHref(locale: SiteLocale, draft?: string): string {
  const base = prefixPath('/plan/start', locale)
  return draft ? `${base}?draft=${encodeURIComponent(draft)}` : base
}
