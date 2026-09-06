import type { SiteLocale } from '@/components/layout/SiteShell'

const SUPPORTED: SiteLocale[] = ['zh', 'en', 'ja']

/**
 * 低-6：起始页是三语共用的非本地化路由，语言由首页跳转时带的 `?locale=` 决定。
 * 认不出来（没带、乱填）返回 `null`，由页面回落到 `getLocale()`（站点统一解析）——
 * URL 是用户可改的输入，不能因为它长得不对就渲染出 key 名。
 */
export function parseStartLocale(raw: string | string[] | undefined): SiteLocale | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return SUPPORTED.find((locale) => locale === value) ?? null
}
