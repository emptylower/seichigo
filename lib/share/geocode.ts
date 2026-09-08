import type { SupportedLocale } from '@/lib/i18n/types'

export type GeocodeAddresses = { zh: string | null; en: string | null; ja: string | null }

type ContextEntry = Record<string, unknown>

/**
 * context[].id 的前缀 → 行政层级序号（0 最粗）。
 * 不在表里的（postal_code / country / …）一律跳过。
 */
const LEVEL_BY_PREFIX: Readonly<Record<string, number>> = {
  region: 0,
  municipality: 1,
  place: 1,
  locality: 2,
  neighbourhood: 2,
}

const LANGS: readonly SupportedLocale[] = ['zh', 'en', 'ja']

/** MapTiler 的 zh 会给「东京都/東京都」这种简繁并列，取 / 前一段 */
function readText(entry: ContextEntry, lang: SupportedLocale): string {
  const localized = entry[`text_${lang}`]
  const fallback = entry.text
  const raw =
    typeof localized === 'string' && localized.trim()
      ? localized
      : typeof fallback === 'string'
        ? fallback
        : ''
  const value = raw.trim()
  if (!value) return ''
  return value.includes('/') ? value.split('/')[0]!.trim() : value
}

export function parseGeocodeAddresses(payload: unknown): GeocodeAddresses {
  const features = (payload as { features?: unknown } | null)?.features
  const feature = Array.isArray(features) ? (features[0] as ContextEntry | undefined) : undefined
  const rawContext = feature?.context
  const context: ContextEntry[] = Array.isArray(rawContext) ? (rawContext as ContextEntry[]) : []

  const out: GeocodeAddresses = { zh: null, en: null, ja: null }
  for (const lang of LANGS) {
    const levels: Array<string | null> = [null, null, null]
    for (const entry of context) {
      if (!entry || typeof entry !== 'object') continue
      const id = typeof entry.id === 'string' ? entry.id : ''
      const level = LEVEL_BY_PREFIX[id.split('.')[0] ?? '']
      if (level === undefined) continue
      if (levels[level]) continue
      const text = readText(entry, lang)
      if (text) levels[level] = text
    }
    const coarseToFine = levels.filter((value): value is string => Boolean(value))
    if (!coarseToFine.length) continue
    // ja/zh 由粗到细空格分隔（東京都 武蔵野市 中町一丁目）；en 由细到粗逗号分隔
    out[lang] = lang === 'en' ? [...coarseToFine].reverse().join(', ') : coarseToFine.join(' ')
  }
  return out
}

/** 上游 4 秒不回就放弃：分享面板等不起，拿不到地址就按无地址画卡片 */
const GEOCODE_TIMEOUT_MS = 4_000

/**
 * 反向地理编码。key 必须字面量访问 `process.env.NEXT_PUBLIC_MAPTILER_KEY`：
 * 动态取值在构建期不会被内联（同 features/map/anitabi/shared.ts:51）。
 * 任何失败（无 key / 非 2xx / 超时 / 响应不是 JSON）都返回 null，由调用方按无地址处理。
 */
export async function fetchMapTilerAddresses(input: {
  lat: number
  lng: number
  fetchImpl?: typeof fetch
}): Promise<GeocodeAddresses | null> {
  const key = String(process.env.NEXT_PUBLIC_MAPTILER_KEY || '').trim()
  if (!key) return null
  const params = new URLSearchParams()
  params.set('key', key)
  params.set('language', 'zh,en,ja')
  params.set('limit', '1')
  const url = `https://api.maptiler.com/geocoding/${input.lng},${input.lat}.json?${params.toString()}`
  try {
    const doFetch = input.fetchImpl ?? fetch
    const res = await doFetch(url, { signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS) })
    if (!res.ok) return null
    return parseGeocodeAddresses(await res.json())
  } catch (error) {
    console.error('[share.geocode.failed]', {
      event: 'share_geocode_failed',
      error: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
    })
    return null
  }
}
