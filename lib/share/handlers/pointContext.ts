import { NextResponse } from 'next/server'
import type { SupportedLocale } from '@/lib/i18n/types'
import { stripAnimeTitlePrefix } from '@/lib/share/displayName'
import type { GeocodeAddresses } from '@/lib/share/geocode'
import { hashIp, readClientIp, utcDateStamp } from '@/lib/share/ipHash'
import type { PointAddressRow, PointContextRepo } from '@/lib/share/pointContextRepo'
import { isInJapan, type PointContextResponse } from '@/lib/share/types'

export const ANON_DAILY_POINT_CONTEXT_LIMIT = 300

export type PointContextDeps = {
  repo: PointContextRepo
  geocode: (input: { lat: number; lng: number }) => Promise<GeocodeAddresses | null>
  now: () => Date
}

type RateEntry = { day: string; count: number }
const rateCounters = new Map<string, RateEntry>()

/**
 * 每 IP 每日 300 次。这条接口不落请求行，没法像 lib/share/handlers/links.ts:69 那样
 * 数 ShareLink 表，只能按 isolate 内计数（同 lib/directions/handlers/directions.ts:57）。
 * 多 isolate 下实际上限会被放大，但地理编码本身有 AnitabiPointAddress 兜底：
 * 每个点位一生只打一次上游，滥用面被缓存钉死。
 */
export function checkPointContextRate(ipHash: string, now: Date): boolean {
  const day = utcDateStamp(now)
  const entry = rateCounters.get(ipHash)
  if (!entry || entry.day !== day) {
    rateCounters.set(ipHash, { day, count: 1 })
    return true
  }
  if (entry.count >= ANON_DAILY_POINT_CONTEXT_LIMIT) return false
  entry.count += 1
  return true
}

/** 单测隔离用 */
export function resetPointContextRate(): void {
  rateCounters.clear()
}

// pointId 会进 URL 与查询条件，字符集与 lib/share/handlers/links.ts:23 保持一致
const POINT_ID_PATTERN = /^[A-Za-z0-9_:.-]{1,200}$/
const LOCALES: readonly string[] = ['zh', 'en', 'ja']

function pickAddress(row: PointAddressRow | null, locale: SupportedLocale): string | null {
  if (!row) return null
  const value = locale === 'en' ? row.addressEn : locale === 'ja' ? row.addressJa : row.addressZh
  const trimmed = String(value || '').trim()
  return trimmed || null
}

export function createGetPointContextHandler(deps: PointContextDeps) {
  return async function getPointContext(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const pointId = String(url.searchParams.get('pointId') || '').trim()
    if (!POINT_ID_PATTERN.test(pointId) || pointId.includes('..')) {
      return NextResponse.json({ error: '参数不合法' }, { status: 400 })
    }
    const rawLocale = String(url.searchParams.get('locale') || 'zh').trim()
    const locale: SupportedLocale = LOCALES.includes(rawLocale) ? (rawLocale as SupportedLocale) : 'zh'

    const now = deps.now()
    const ip = readClientIp(req)
    if (ip) {
      const ipHash = await hashIp(ip, now)
      if (!checkPointContextRate(ipHash, now)) {
        return NextResponse.json({ error: '今日请求次数已达上限，请明天再试' }, { status: 429 })
      }
    }

    const point = await deps.repo.findPoint(pointId, locale)
    if (!point) return NextResponse.json({ error: '点位不存在' }, { status: 404 })

    const rawName = String(point.localizedName || point.name || '').trim()
    const animeTitle = String(point.localizedBangumiTitle || point.bangumiTitleCandidates[0] || '').trim()
    const candidates = [point.localizedBangumiTitle, ...point.bangumiTitleCandidates].filter(
      (value): value is string => Boolean(value && value.trim()),
    )
    const displayName = stripAnimeTitlePrefix(rawName, candidates)
    const note = String(point.localizedNote || point.mark || '').trim() || null
    const geo: [number, number] | null =
      point.geoLat != null && point.geoLng != null ? [point.geoLat, point.geoLng] : null

    let address = pickAddress(await deps.repo.findAddress(pointId), locale)
    if (!address && geo) {
      const resolved = await deps.geocode({ lat: geo[0], lng: geo[1] })
      // 三语全空说明上游没给出可用的行政区，不写缓存，下次还能再试
      if (resolved && (resolved.zh || resolved.en || resolved.ja)) {
        const row: PointAddressRow = {
          pointId,
          addressZh: resolved.zh,
          addressEn: resolved.en,
          addressJa: resolved.ja,
        }
        await deps.repo.saveAddress({ ...row, source: 'maptiler' }).catch((error: unknown) => {
          console.error('[share.point_context.cache_write_failed]', { pointId, error })
        })
        address = pickAddress(row, locale)
      }
    }

    const body: PointContextResponse = {
      address,
      geo,
      note,
      inJapan: geo ? isInJapan(geo[0], geo[1]) : false,
      displayName,
      animeTitle,
    }
    // 有坐标却没拿到地址（上游未回/预算耗尽）：可能是暂时性失败，公共缓存只敢放 5 分钟
    const cacheControl = geo && !address ? 'public, max-age=300' : 'public, max-age=86400'
    return NextResponse.json(body, {
      status: 200,
      headers: { 'cache-control': cacheControl },
    })
  }
}
