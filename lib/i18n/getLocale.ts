import { headers } from 'next/headers'
import type { SupportedLocale } from './types'

const DEFAULT_LOCALE: SupportedLocale = 'zh'

export async function getLocale(): Promise<SupportedLocale> {
  const headersList = await headers()
  const acceptLanguage = headersList.get('accept-language')
  
  if (!acceptLanguage) {
    return DEFAULT_LOCALE
  }

  if (acceptLanguage.includes('ja')) {
    return 'ja'
  }
  
  if (acceptLanguage.includes('en')) {
    return 'en'
  }
  
  return DEFAULT_LOCALE
}
