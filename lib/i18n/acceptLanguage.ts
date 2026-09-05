import type { SupportedLocale } from './types'

type AcceptLanguageEntry = {
  tag: string
  quality: number
  order: number
}

function parseEntry(rawEntry: string, order: number): AcceptLanguageEntry | null {
  const segments = rawEntry.split(';')
  const tag = segments[0]?.trim().toLowerCase()
  if (!tag) return null

  let quality = 1
  for (const segment of segments.slice(1)) {
    const [rawKey, ...rawValue] = segment.trim().split('=')
    if (rawKey?.trim().toLowerCase() !== 'q') continue
    const parsed = Number.parseFloat(rawValue.join('=').trim())
    if (Number.isNaN(parsed)) continue
    quality = Math.min(Math.max(parsed, 0), 1)
  }

  if (quality <= 0) return null
  return { tag, quality, order }
}

export function pickLocaleFromAcceptLanguage(
  header: string | null | undefined
): SupportedLocale | null {
  if (!header) return null

  const entries: AcceptLanguageEntry[] = []
  for (const rawEntry of header.split(',')) {
    const entry = parseEntry(rawEntry, entries.length)
    if (entry) entries.push(entry)
  }

  if (entries.length === 0) return null

  entries.sort((a, b) => b.quality - a.quality || a.order - b.order)

  const topTag = entries[0].tag
  if (topTag === '*') return null

  const primaryTag = topTag.split('-')[0]
  if (primaryTag === 'zh') return 'zh'
  if (primaryTag === 'ja') return 'ja'
  return 'en'
}
