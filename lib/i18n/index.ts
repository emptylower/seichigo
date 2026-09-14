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

/**
 * 数组型词条（如 `pages.planStart.suggestions`）：元素结构由调用方断言，
 * 缺 key 或不是数组时返回空数组（与 t() 缺 key 回退 key 名的策略分开，
 * 数组没有可回退的字符串形态）。
 */
export function tArray<T>(key: string, locale: SupportedLocale): T[] {
  const dict = translations[locale]
  const keys = key.split('.')
  let current: unknown = dict
  for (const k of keys) {
    if (current === null || typeof current !== 'object') return []
    current = (current as Record<string, unknown>)[k]
  }
  return Array.isArray(current) ? (current as T[]) : []
}
