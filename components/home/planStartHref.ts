import type { SiteLocale } from '@/components/layout/SiteShell'

/**
 * 低-6：规划师起始页 `/plan/start` 是三语共用的非本地化路由（`prefixPath` 里
 * `/plan` 明确不加语言前缀），语言只能靠 query 带过去——zh 是默认值不带，
 * en/ja 带 `?locale=`，起始页与登录弹窗据此取文案。
 */
export function planStartHref(locale: SiteLocale, draft?: string): string {
  const parts: string[] = []
  if (draft) parts.push(`draft=${encodeURIComponent(draft)}`)
  if (locale !== 'zh') parts.push(`locale=${locale}`)
  return parts.length ? `/plan/start?${parts.join('&')}` : '/plan/start'
}
