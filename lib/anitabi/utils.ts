import crypto from 'crypto'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { AnitabiMapTab } from '@/lib/anitabi/types'

export const ANITABI_TAB_LABELS: Record<SupportedLocale, Record<AnitabiMapTab, string>> = {
  zh: {
    latest: '最新更新',
    recent: '近期新作',
    hot: '热门作品',
    nearby: '附近的点位',
  },
  en: {
    latest: 'Latest Updates',
    recent: 'Recent Releases',
    hot: 'Trending',
    nearby: 'Nearby Works',
  },
  ja: {
    latest: '最新更新',
    recent: '新着作品',
    hot: '人気作品',
    nearby: '近くの作品',
  },
}

export function normalizeLocale(input: string | null | undefined): SupportedLocale {
  if (input === 'en' || input === 'ja') return input
  return 'zh'
}

export function clampInt(value: string | number | null | undefined, fallback: number, min: number, max: number): number {
  const raw = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, raw))
}

export function parseTab(value: string | null | undefined): AnitabiMapTab {
  if (value === 'recent' || value === 'hot' || value === 'nearby') return value
  return 'latest'
}

export function parseUserLocation(params: URLSearchParams): { lat: number; lng: number } | null {
  const latRaw = params.get('ulat') ?? params.get('lat')
  const lngRaw = params.get('ulng') ?? params.get('lng')
  if (latRaw == null || lngRaw == null) return null
  if (!latRaw.trim() || !lngRaw.trim()) return null

  const lat = toNumberOrNull(latRaw)
  const lng = toNumberOrNull(lngRaw)
  if (lat == null || lng == null) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export function hashText(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

export function normalizeText(input: unknown): string {
  return String(input ?? '').trim()
}

export function toNumberOrNull(input: unknown): number | null {
  const n = Number(input)
  return Number.isFinite(n) ? n : null
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

export async function asyncPool<T, R>(
  values: T[],
  limit: number,
  fn: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const concurrency = Math.max(1, limit)
  const ret: R[] = new Array(values.length)
  let cursor = 0

  async function worker() {
    while (cursor < values.length) {
      const index = cursor++
      ret[index] = await fn(values[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return ret
}

function normalizeBaseUrl(input: string | null | undefined): string {
  const fallback = 'https://www.anitabi.cn'
  const base = normalizeText(input) || fallback
  return base.replace(/\/+$/, '')
}

export function getAnitabiSiteBaseUrl(): string {
  return normalizeBaseUrl(process.env.ANITABI_SITE_BASE_URL)
}

export function resolveAnitabiAssetUrl(value: string | null | undefined, baseUrl?: string | null): string | null {
  const text = normalizeText(value)
  if (!text) return null

  if (/^http:\/\//i.test(text)) {
    return text.replace(/^http:\/\//i, 'https://')
  }

  if (/^https:\/\//i.test(text)) {
    return text
  }

  if (text.startsWith('//')) {
    return `https:${text}`
  }

  if (text.startsWith('/')) {
    return `${normalizeBaseUrl(baseUrl)}${text}`
  }

  return text
}

/**
 * Calculates the Haversine distance between two points on the Earth.
 * @returns distance in meters
 */
export function getHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3 // metres
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // in metres
}
