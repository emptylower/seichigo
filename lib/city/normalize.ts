import crypto from 'node:crypto'

export function normalizeCityAlias(input: string): string {
  const raw = String(input || '')
  const normalized = raw.normalize('NFKC')
  return normalized
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function slugifyAscii(input: string): string {
  const raw = String(input || '')
  const normalized = raw.normalize('NFKC').toLowerCase()
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
  return slug
}

export function randomSlugSuffix(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}
