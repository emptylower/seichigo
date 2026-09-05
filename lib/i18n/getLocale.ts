import { headers } from 'next/headers'
import type { SupportedLocale } from './types'
import { pickLocaleFromAcceptLanguage } from './acceptLanguage'

const DEFAULT_LOCALE: SupportedLocale = 'zh'

export async function getLocale(): Promise<SupportedLocale> {
  const headersList = await headers()
  return pickLocaleFromAcceptLanguage(headersList.get('accept-language')) ?? DEFAULT_LOCALE
}
