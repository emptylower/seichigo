import type { SupportedLocale } from './types'

export type LocalizedDisplayNameRecord = {
  name?: string | null
  name_zh?: string | null
  name_en?: string | null
  name_ja?: string | null
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.map((value) => String(value || '').trim()).find(Boolean) || ''
}

/** Resolve a database-backed display name without changing the source identifier. */
export function getLocalizedDisplayName(
  record: LocalizedDisplayNameRecord,
  locale: SupportedLocale
): string {
  const fallback = firstNonEmpty(record.name_zh, record.name)
  if (locale === 'en') return firstNonEmpty(record.name_en, fallback)
  if (locale === 'ja') return firstNonEmpty(record.name_ja, fallback)
  return fallback
}

export function normalizeDisplayNameKey(input: string): string {
  return String(input || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
}
