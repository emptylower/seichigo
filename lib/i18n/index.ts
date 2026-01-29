import type { SupportedLocale, TranslationDictionary } from './types'
import zhTranslations from './locales/zh.json'
import enTranslations from './locales/en.json'
import jaTranslations from './locales/ja.json'

const translations: Record<SupportedLocale, TranslationDictionary> = {
  zh: zhTranslations,
  en: enTranslations,
  ja: jaTranslations
}

export function t(key: string, locale: SupportedLocale): string {
  const dict = translations[locale]
  return dict[key] ?? key
}
