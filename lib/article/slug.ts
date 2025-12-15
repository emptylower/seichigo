import crypto from 'node:crypto'

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
