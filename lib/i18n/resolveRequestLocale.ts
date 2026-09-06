import type { SupportedLocale } from './types'
import { pickLocaleFromAcceptLanguage } from './acceptLanguage'

const DEFAULT_LOCALE: SupportedLocale = 'zh'

const LOCALE_COOKIE_PATTERN = /(?:^|;\s*)NEXT_LOCALE=(zh|en|ja)(?:;|$)/

function localeFromPathname(pathname: string): SupportedLocale | null {
  if (pathname === '/en' || pathname.startsWith('/en/')) return 'en'
  if (pathname === '/ja' || pathname.startsWith('/ja/')) return 'ja'
  return null
}

function localeFromCookie(cookieHeader: string | null): SupportedLocale | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(LOCALE_COOKIE_PATTERN)
  return (match?.[1] as SupportedLocale) ?? null
}

/**
 * 站点统一语言解析：路径前缀 > NEXT_LOCALE cookie > accept-language > zh。
 * middleware 与服务端共用，保证 /plan 等非前缀路由与站点其余部分一致。
 */
export function resolveRequestLocale(input: {
  pathname: string
  cookieHeader: string | null
  acceptLanguage: string | null
}): SupportedLocale {
  const fromPath = localeFromPathname(input.pathname)
  if (fromPath) return fromPath

  const fromCookie = localeFromCookie(input.cookieHeader)
  if (fromCookie) return fromCookie

  return pickLocaleFromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE
}
