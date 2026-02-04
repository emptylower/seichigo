import { extractLatLngFromGoogleMapsUrl } from '@/lib/route/google'
import type { SeichiRouteSpotV1 } from '@/lib/route/schema'

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

function safeIsoString(input: unknown): string | undefined {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return undefined
  const dt = new Date(raw)
  if (!Number.isFinite(dt.getTime())) return undefined
  return dt.toISOString()
}

export function buildBreadcrumbListJsonLd(items: { name: string; url: string }[]): JsonLdObject | null {
  const cleaned = items
    .map((it) => ({ name: String(it.name || '').trim(), url: safeUrl(it.url) }))
    .filter((it) => it.name && it.url) as { name: string; url: string }[]

  if (cleaned.length < 2) return null

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: cleaned.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.name,
      // Some validators require `item` to be an object with `@id` instead of a URL string.
      item: { '@id': it.url },
    })),
  }
}

export function buildBlogPostingJsonLd(input: {
  url: string
  title: string
  description: string
  siteName: string
  siteUrl: string
  imageUrl?: string | null
  datePublished?: string | null
  dateModified?: string | null
  about?: { type: 'CreativeWork' | 'Place'; name: string }[]
  keywords?: string[]
  inLanguage?: string
  author?: { type: 'Person' | 'Organization'; name: string; url?: string | null }
  wordCount?: number
  articleSection?: string
}): JsonLdObject {
  const url = safeUrl(input.url) || input.url
  const siteUrl = safeUrl(input.siteUrl) || input.siteUrl

  let publisherLogoUrl: string | undefined
  try {
    publisherLogoUrl = safeUrl(new URL('/brand/app-logo.png', siteUrl).toString()) || undefined
  } catch {
    publisherLogoUrl = undefined
  }

  const out: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: String(input.title || '').trim(),
    description: String(input.description || '').trim(),
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    isPartOf: { '@type': 'Blog', name: String(input.siteName || '').trim(), url: siteUrl },
    publisher: {
      '@type': 'Organization',
      name: String(input.siteName || '').trim(),
      url: siteUrl,
      ...(publisherLogoUrl ? { logo: publisherLogoUrl } : {}),
    },
  }

  const authorName = String(input.author?.name || '').trim()
  const authorType = input.author?.type
  const authorUrl = safeUrl(input.author?.url)
  if (authorType === 'Person' || authorType === 'Organization') {
    out.author = {
      '@type': authorType,
      name: authorName || String(input.siteName || '').trim(),
      ...(authorUrl ? { url: authorUrl } : {}),
    }
  } else {
    out.author = {
      '@type': 'Organization',
      name: String(input.siteName || '').trim(),
      url: siteUrl,
    }
  }

  const lang = typeof input.inLanguage === 'string' ? input.inLanguage.trim() : ''
  if (lang) out.inLanguage = lang

  const imageUrl = safeUrl(input.imageUrl)
  if (imageUrl) out.image = [imageUrl]

  const datePublished = safeIsoString(input.datePublished)
  if (datePublished) out.datePublished = datePublished

  const dateModified = safeIsoString(input.dateModified)
  if (dateModified) out.dateModified = dateModified

  const about =
    Array.isArray(input.about) && input.about.length
      ? input.about
          .map((a) => ({ type: a.type, name: String(a.name || '').trim() }))
          .filter((a) => (a.type === 'CreativeWork' || a.type === 'Place') && a.name)
      : []
  if (about.length) {
    out.about = about.map((a) => ({ '@type': a.type, name: a.name }))
  }

  const keywords = Array.isArray(input.keywords) ? input.keywords.map((k) => String(k || '').trim()).filter(Boolean) : []
  if (keywords.length) out.keywords = keywords.join(', ')

  if (typeof input.wordCount === 'number' && input.wordCount > 0) {
    out.wordCount = input.wordCount
  }
  if (input.articleSection) {
    out.articleSection = input.articleSection
  }

  return out
}

function spotLabel(spot: SeichiRouteSpotV1, order: number): string {
  const zh = typeof spot.name_zh === 'string' ? spot.name_zh.trim() : ''
  const name = typeof spot.name === 'string' ? spot.name.trim() : ''
  return zh || name || `Spot ${order}`
}

function resolveLatLng(spot: SeichiRouteSpotV1): { lat: number; lng: number } | null {
  if (typeof spot.lat === 'number' && Number.isFinite(spot.lat) && typeof spot.lng === 'number' && Number.isFinite(spot.lng)) {
    return { lat: spot.lat, lng: spot.lng }
  }
  const fromUrl = extractLatLngFromGoogleMapsUrl(String(spot.googleMapsUrl || ''))
  return fromUrl
}

export function buildRouteItemListJsonLd(spots: SeichiRouteSpotV1[], options?: { name?: string }): JsonLdObject | null {
  const listItems = spots
    .map((spot, idx) => {
      const position = idx + 1
      const nameJa = typeof spot.name_ja === 'string' ? spot.name_ja.trim() : ''
      const labelZh = spotLabel(spot, position)
      const name = nameJa ? `${labelZh}（${nameJa}）` : labelZh
      const coords = resolveLatLng(spot)

      const url = safeUrl(spot.googleMapsUrl)
      const place: JsonLdObject = {
        '@type': 'Place',
        name,
      }
      if (coords) {
        place.geo = { '@type': 'GeoCoordinates', latitude: coords.lat, longitude: coords.lng }
      }
      if (url) place.url = url

      return { '@type': 'ListItem', position, item: place }
    })
    .filter(Boolean) as JsonLdObject[]

  if (!listItems.length) return null

  const name = typeof options?.name === 'string' ? options.name.trim() : ''

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    ...(name ? { name } : {}),
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: listItems,
  }
}

export function serializeJsonLd(data: unknown): string {
  // Prevent `</script>` and similar sequences from breaking out of the JSON-LD script tag.
  // Escaping `<` is the standard mitigation.
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

