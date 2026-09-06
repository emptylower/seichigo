import type { SupportedLocale } from './types'

const INTL_LOCALES: Record<SupportedLocale, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
}

export function toIntlLocale(locale: SupportedLocale): string {
  return INTL_LOCALES[locale]
}
