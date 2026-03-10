import type { SupportedLocale } from '@/lib/i18n/types'
import type { AnitabiBangumiCard } from '@/lib/anitabi/types'
import { normalizeText, resolveAnitabiAssetUrl } from '@/lib/anitabi/utils'

function pickLocalizedTitle(
  locale: SupportedLocale,
  row: {
    titleZh: string | null
    titleJaRaw: string | null
    i18n?: Array<{ title: string | null }>
  }
): string {
  const translated = normalizeText(row.i18n?.[0]?.title)
  if (translated) return translated
  return normalizeText(row.titleZh) || normalizeText(row.titleJaRaw) || '#'
}

export function toCard(
  locale: SupportedLocale,
  row: {
    id: number
    titleZh: string | null
    titleJaRaw: string | null
    cat: string | null
    city: string | null
    cover: string | null
    color: string | null
    sourceModifiedMs: bigint | null
    mapEnabled: boolean
    geoLat: number | null
    geoLng: number | null
    zoom: number | null
    i18n: Array<{ title: string | null }>
    meta: {
      pointsLength: number
      imagesLength: number
    } | null
  }
): AnitabiBangumiCard {
  return {
    id: row.id,
    title: pickLocalizedTitle(locale, row),
    titleZh: row.titleZh,
    cat: row.cat,
    city: row.city,
    cover: resolveAnitabiAssetUrl(row.cover),
    color: row.color,
    pointsLength: row.meta?.pointsLength || 0,
    imagesLength: row.meta?.imagesLength || 0,
    sourceModifiedMs: row.sourceModifiedMs == null ? null : Number(row.sourceModifiedMs),
    mapEnabled: row.mapEnabled,
    geo: row.geoLat != null && row.geoLng != null ? [row.geoLat, row.geoLng] : null,
    zoom: row.zoom,
    nearestDistanceMeters: null,
  }
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const earthRadius = 6378137
  const latDelta = toRadians(b.lat - a.lat)
  const lngDelta = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const sinLat = Math.sin(latDelta / 2)
  const sinLng = Math.sin(lngDelta / 2)
  const m = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(m)))
}
