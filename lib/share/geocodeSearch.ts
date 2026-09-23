import type { SupportedLocale } from '@/lib/i18n/types'

// ---------------------------------------------------------------------------
// MapTiler 正向地址搜索（B2 A1）：给自定义点编辑对话框的地址搜索框用。
// key 与反向地理编码 fetchMapTilerAddresses 同一环境变量；任何失败
// （无 key / 非 2xx / 超时 / 响应不是 JSON）都返回空数组，由前端按无结果处理。
// ---------------------------------------------------------------------------

export type GeocodeSearchResult = { title: string; address: string | null; lat: number; lng: number }

export type GeocodeSearchInput = {
  q: string
  lang: SupportedLocale
  near?: { lat: number; lng: number } | null
  fetchImpl?: typeof fetch
}

export const GEOCODE_SEARCH_LIMIT = 5

/** 上游 4 秒不回就放弃：搜索框等不起，拿不到就按无结果处理 */
const GEOCODE_SEARCH_TIMEOUT_MS = 4_000

type SearchFeature = Record<string, unknown>

function readString(feature: SearchFeature, key: string): string | null {
  const value = feature[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** MapTiler center 是 [lng, lat]，越界/非数字视为无效 */
function readCenter(feature: SearchFeature): { lat: number; lng: number } | null {
  const center = feature.center
  if (!Array.isArray(center) || center.length < 2) return null
  const lng = Number(center[0])
  const lat = Number(center[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export function parseGeocodeSearchResults(payload: unknown, lang: SupportedLocale = 'zh', limit: number = GEOCODE_SEARCH_LIMIT): GeocodeSearchResult[] {
  const features = (payload as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) return []

  const results: GeocodeSearchResult[] = []
  for (const raw of features) {
    if (results.length >= limit) break
    if (!raw || typeof raw !== 'object') continue
    const feature = raw as SearchFeature

    const center = readCenter(feature)
    if (!center) continue

    // language=<lang> 时 text/place_name 已本地化；多语言请求会出现 text_zh 等后缀字段，优先取
    const title =
      readString(feature, `text_${lang}`) ??
      readString(feature, 'text') ??
      readString(feature, `place_name_${lang}`) ??
      readString(feature, 'place_name')
    if (!title) continue

    const address = readString(feature, `place_name_${lang}`) ?? readString(feature, 'place_name')
    results.push({ title, address: address && address !== title ? address : null, lat: center.lat, lng: center.lng })
  }
  return results
}

export async function fetchGeocodeSearchResults(input: GeocodeSearchInput): Promise<GeocodeSearchResult[]> {
  const key = String(process.env.NEXT_PUBLIC_MAPTILER_KEY || '').trim()
  if (!key) return []

  const params = new URLSearchParams()
  params.set('key', key)
  params.set('language', input.lang)
  params.set('limit', String(GEOCODE_SEARCH_LIMIT))
  if (input.near) params.set('proximity', `${input.near.lng},${input.near.lat}`)
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(input.q)}.json?${params.toString()}`

  try {
    const doFetch = input.fetchImpl ?? fetch
    const res = await doFetch(url, { signal: AbortSignal.timeout(GEOCODE_SEARCH_TIMEOUT_MS) })
    if (!res.ok) return []
    return parseGeocodeSearchResults(await res.json(), input.lang)
  } catch (error) {
    console.error('[share.geocodeSearch.failed]', {
      event: 'share_geocode_search_failed',
      error: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
    })
    return []
  }
}
