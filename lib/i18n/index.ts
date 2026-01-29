import type { SupportedLocale } from './types'
import zhTranslations from './locales/zh.json'
import enTranslations from './locales/en.json'
import jaTranslations from './locales/ja.json'

type NestedTranslations = Record<string, string | Record<string, unknown>>

const translations: Record<SupportedLocale, NestedTranslations> = {
  zh: zhTranslations,
  en: enTranslations,
  ja: jaTranslations
}

function getNestedValue(obj: NestedTranslations, path: string): string | undefined {
  const keys = path.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' ? current : undefined
}

export function t(key: string, locale: SupportedLocale): string {
  const dict = translations[locale]
  return getNestedValue(dict, key) ?? key
}
