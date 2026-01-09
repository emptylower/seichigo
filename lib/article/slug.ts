import crypto from 'node:crypto'

const READABLE_SLUG_RE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u

function slugifyAscii(input: string): string {
  return input
    .trim()
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function fallbackSlug(title: string): string {
  const normalized = title.trim().normalize('NFKC')
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 10)
  return `post-${hash}`
}

export function generateSlugFromTitle(title: string, now: Date): string {
  void now
  const ascii = slugifyAscii(title)
  return ascii || fallbackSlug(title)
}

export function normalizeArticleSlug(input: string): string {
  return input.trim().normalize('NFKC').toLowerCase()
}

export function isValidArticleSlug(slug: string): boolean {
  const trimmed = slug.trim()
  if (!trimmed) return false
  if (trimmed.length > 128) return false
  if (trimmed !== trimmed.toLowerCase()) return false
  return READABLE_SLUG_RE.test(trimmed)
}

export function isFallbackHashSlug(slug: string): boolean {
  return /^post-[0-9a-f]{10}$/.test(slug.trim())
}
