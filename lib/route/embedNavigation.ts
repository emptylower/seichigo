import {
  buildGoogleMapsEmbedDirectionsUrl,
  buildGoogleMapsEmbedPlaceUrl,
  type GoogleMapsTravelMode,
  type LatLng,
} from './google'

export const EMBED_API_KEY = String(
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY ||
    ''
).trim()

export const TRAVEL_MODE_OPTIONS: ReadonlyArray<{ value: GoogleMapsTravelMode; label: string }> = [
  { value: 'walking', label: '步行' },
  { value: 'transit', label: '公交' },
  { value: 'driving', label: '驾车' },
  { value: 'bicycling', label: '骑行' },
]

const NATIVE_APP_MODE_PARAM: Record<GoogleMapsTravelMode, string> = {
  walking: 'w',
  driving: 'd',
  bicycling: 'b',
  transit: 'r',
}

export function travelModeLabel(mode: GoogleMapsTravelMode): string {
  return TRAVEL_MODE_OPTIONS.find((option) => option.value === mode)?.label || mode
}

export function resolveEmbedNavUrl(
  destination: string | LatLng,
  userLocation: LatLng | null,
  mode: GoogleMapsTravelMode
): string | null {
  if (userLocation) {
    return buildGoogleMapsEmbedDirectionsUrl({
      apiKey: EMBED_API_KEY,
      origin: { lat: userLocation.lat, lng: userLocation.lng },
      destination,
      mode,
    })
  }
  return buildGoogleMapsEmbedPlaceUrl({ apiKey: EMBED_API_KEY, q: destination, zoom: 15 })
}

export function buildGoogleNativeAppUrl(destinationQuery: string, mode: GoogleMapsTravelMode): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent.toLowerCase()
  const encoded = encodeURIComponent(destinationQuery)
  if (ua.includes('android')) {
    return `google.navigation:q=${encoded}&mode=${NATIVE_APP_MODE_PARAM[mode]}`
  }
  return `comgooglemaps://?daddr=${encoded}&directionsmode=${mode}`
}
