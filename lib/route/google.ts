export type LatLng = { lat: number; lng: number }

export type GoogleMapsTravelMode = 'driving' | 'walking' | 'bicycling' | 'transit'

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function isValidLatLng(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

function toLatLng(lat: number, lng: number): LatLng | null {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null
  if (!isValidLatLng(lat, lng)) return null
  return { lat, lng }
}

function parseLatLngPair(raw: string): LatLng | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return toLatLng(lat, lng)
}

export function extractLatLngFromGoogleMapsUrl(input: string): LatLng | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (raw.startsWith('//')) return null

  // Common patterns in path fragments.
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(raw)
  if (at) return toLatLng(Number(at[1]), Number(at[2]))

  const bang = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(raw)
  if (bang) return toLatLng(Number(bang[1]), Number(bang[2]))

  try {
    const url = new URL(raw)
    const candidates = [
      url.searchParams.get('query'),
      url.searchParams.get('q'),
      url.searchParams.get('ll'),
      url.searchParams.get('center'),
    ]
    for (const c of candidates) {
      if (!c) continue
      const parsed = parseLatLngPair(c)
      if (parsed) return parsed
    }
  } catch {
    // ignore
  }

  return null
}

function formatLatLng(p: LatLng): string {
  return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
}

export function buildGoogleMapsDirectionsUrls(
  points: LatLng[],
  options?: { maxStopsPerUrl?: number; travelmode?: GoogleMapsTravelMode }
): string[] {
  const maxStopsPerUrl = Math.max(2, Math.trunc(options?.maxStopsPerUrl ?? 20))
  if (!Array.isArray(points) || points.length < 2) return []

  const urls: string[] = []
  let start = 0
  while (start < points.length - 1) {
    const end = Math.min(points.length - 1, start + maxStopsPerUrl - 1)
    const segment = points.slice(start, end + 1)
    if (segment.length < 2) break

    const params = new URLSearchParams()
    params.set('api', '1')
    params.set('origin', formatLatLng(segment[0]!))
    params.set('destination', formatLatLng(segment[segment.length - 1]!))

    if (segment.length > 2) {
      const waypoints = segment
        .slice(1, -1)
        .map((p) => formatLatLng(p))
        .join('|')
      params.set('waypoints', waypoints)
    }

    if (options?.travelmode) params.set('travelmode', options.travelmode)

    urls.push(`https://www.google.com/maps/dir/?${params.toString()}`)
    start = end
  }

  return urls
}

function markerLabel(order: number): string | null {
  if (order >= 1 && order <= 9) return String(order)
  const idx = order - 10
  if (idx >= 0 && idx < 26) return String.fromCharCode(65 + idx) // A-Z
  return null
}

export function buildGoogleStaticMapUrl(
  points: LatLng[],
  options: {
    apiKey: string
    width?: number
    height?: number
    scale?: 1 | 2
    maptype?: 'roadmap' | 'terrain' | 'satellite' | 'hybrid'
  }
): string | null {
  const apiKey = String(options.apiKey || '').trim()
  if (!apiKey) return null
  if (!Array.isArray(points) || points.length < 1) return null

  const width = Math.max(10, Math.trunc(options.width ?? 640))
  const height = Math.max(10, Math.trunc(options.height ?? 360))
  const scale = options.scale ?? 2
  const maptype = options.maptype ?? 'roadmap'

  const params = new URLSearchParams()
  params.set('size', `${width}x${height}`)
  params.set('scale', String(scale))
  params.set('maptype', maptype)
  params.set('format', 'png')
  params.set('key', apiKey)

  if (points.length >= 2) {
    const path = ['color:0xf472b6ff', 'weight:4', ...points.map(formatLatLng)].join('|')
    params.append('path', path)
  }

  for (let i = 0; i < points.length; i++) {
    const label = markerLabel(i + 1)
    const marker = ['color:0xf472b6', ...(label ? [`label:${label}`] : []), formatLatLng(points[i]!)].join('|')
    params.append('markers', marker)
  }

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
}

