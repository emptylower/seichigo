import { headers } from 'next/headers'
import { resolveRequestLocale } from '@/lib/i18n/resolveRequestLocale'
import type { SupportedLocale } from '@/lib/i18n/types'

export async function getAuthLocale(): Promise<SupportedLocale> {
  const requestHeaders = await headers()
  const locale = requestHeaders.get('x-seichigo-locale')
  if (locale === 'zh' || locale === 'en' || locale === 'ja') return locale

  return resolveRequestLocale({
    pathname: requestHeaders.get('x-seichigo-pathname') || '/',
    cookieHeader: requestHeaders.get('cookie'),
    acceptLanguage: requestHeaders.get('accept-language'),
  })
}
