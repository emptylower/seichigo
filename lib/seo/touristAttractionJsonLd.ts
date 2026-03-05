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

export function buildTouristAttractionJsonLd(input: {
  name: string
  description?: string | null
  url?: string | null
  geo?: { latitude: number; longitude: number } | null
  image?: string | null
  touristType?: string | null
  inLanguage?: string | null
  alternateName?: string[]
}): JsonLdObject {
  const name = String(input.name || '').trim()
  const out: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name,
  }
  const url = safeUrl(input.url)
  if (url) out.url = url
  const desc = String(input.description || '').trim()
  if (desc) out.description = desc
  if (input.geo?.latitude != null && input.geo?.longitude != null) {
    out.geo = {
      '@type': 'GeoCoordinates',
      latitude: input.geo.latitude,
      longitude: input.geo.longitude,
    }
  }
  const image = safeUrl(input.image)
  if (image) out.image = [image]
  const touristType = String(input.touristType || '').trim()
  if (touristType) out.touristType = touristType
  const lang = String(input.inLanguage || '').trim()
  if (lang) out.inLanguage = lang
  const altNames = Array.isArray(input.alternateName)
    ? input.alternateName.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  if (altNames.length) out.alternateName = altNames
  return out
}
