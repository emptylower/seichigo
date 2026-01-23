import { getSiteOrigin } from '@/lib/seo/site'

type JsonLdObject = Record<string, any>

function safeUrl(input: unknown): string | null {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return null
  if (raw.startsWith('//')) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function toAbsoluteUrlMaybe(input: unknown): string | undefined {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return undefined
  const origin = getSiteOrigin()
  try {
    return new URL(raw, origin).toString()
  } catch {
    return undefined
  }
}

export function buildAnimeWorkJsonLd(input: {
  url: string
  name: string
  description?: string | null
  imageUrl?: string | null
  alternateNames?: string[]
  year?: number | null
  inLanguage?: string
  type?: 'TVSeries' | 'Movie' | 'CreativeWork'
}): JsonLdObject {
  const url = safeUrl(input.url) || input.url

  const name = String(input.name || '').trim()
  const description = String(input.description || '').trim()

  const type = input.type === 'TVSeries' || input.type === 'Movie' ? input.type : 'CreativeWork'
  const imageUrl = toAbsoluteUrlMaybe(input.imageUrl)
  const altNames = Array.isArray(input.alternateNames)
    ? input.alternateNames.map((x) => String(x || '').trim()).filter(Boolean)
    : []

  const out: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': type,
    name,
    url,
  }

  const lang = typeof input.inLanguage === 'string' ? input.inLanguage.trim() : ''
  if (lang) out.inLanguage = lang
  if (description) out.description = description
  if (imageUrl) out.image = [imageUrl]
  if (altNames.length) out.alternateName = altNames

  const year = typeof input.year === 'number' && Number.isFinite(input.year) ? input.year : null
  if (year) out.datePublished = `${year}-01-01`

  return out
}
