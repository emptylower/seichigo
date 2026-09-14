import type { SiteLocale } from '@/components/layout/SiteShell'

const SUPPORTED: SiteLocale[] = ['zh', 'en', 'ja']

/**
 * 旧链接兼容：`/plan/start?locale=en|ja` 曾是三语共用的 query 协议，现在只由
 * 中文 page 在读会话之前消费——解析出 en/ja 就 307 到对应语言路径。认不出来
 * （没带、乱填、zh）返回 `null`，页面留在中文；URL 是用户可改的输入，不能
 * 因为它长得不对就渲染出 key 名。
 */
export function parseStartLocale(raw: string | string[] | undefined): SiteLocale | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return SUPPORTED.find((locale) => locale === value) ?? null
}

