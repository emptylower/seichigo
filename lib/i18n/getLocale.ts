import { headers } from 'next/headers'
import type { SupportedLocale } from './types'
import { pickLocaleFromAcceptLanguage } from './acceptLanguage'

const DEFAULT_LOCALE: SupportedLocale = 'zh'
const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['zh', 'en', 'ja']

export async function getLocale(): Promise<SupportedLocale> {
  const headersList = await headers()

  const headerLocale = headersList.get('x-seichigo-locale')
  if (headerLocale && SUPPORTED_LOCALES.includes(headerLocale as SupportedLocale)) {
    return headerLocale as SupportedLocale
  }

  return pickLocaleFromAcceptLanguage(headersList.get('accept-language')) ?? DEFAULT_LOCALE
}
