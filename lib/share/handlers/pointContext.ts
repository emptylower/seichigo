import { NextResponse } from 'next/server'
import type { SupportedLocale } from '@/lib/i18n/types'
import { stripAnimeTitlePrefix } from '@/lib/share/displayName'
import type { GeocodeAddresses } from '@/lib/share/geocode'
import { hashIp, readClientIp, utcDateStamp } from '@/lib/share/ipHash'
import type { PointAddressRow, PointContextRepo } from '@/lib/share/pointContextRepo'
import { isInJapan, type PointContextResponse } from '@/lib/share/types'

export const ANON_DAILY_POINT_CONTEXT_LIMIT = 300

/** 全局每日地理编码回填预算：按 AnitabiPointAddress.resolvedAt 当日计数，超出后跳过上游 */
export const DAILY_GEOCODE_BUDGET = 2_000

export type PointContextDeps = {
  repo: PointContextRepo
  geocode: (input: {
    lat: number
    lng: number
    /** 海外点位要国家段（en 末尾 / zh、ja 前置） */
    includeCountry?: boolean
  }) => Promise<GeocodeAddresses | null>
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
    // 跨日顺手清理：表被撑到 5000+ 才扫一遍，删掉所有非当日的 key，
    // 防止只来一次的长尾 IP 把 Map 无限撑大（每天最多清一次量级）
    if (rateCounters.size > 5000) {
      for (const [key, value] of rateCounters) {
        if (value.day !== day) rateCounters.delete(key)
      }
    }
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

/** 单测观察限流表大小用（跨日清理的验证） */
export function pointContextRateSize(): number {
  return rateCounters.size
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

/** 卡片渲染要用、但 PointContextResponse 里没有的那几项也一并带出来 */
export type LoadedPointContext = {
  bangumiId: number
  displayName: string
  animeTitle: string
  address: string | null
  geo: [number, number] | null
  note: string | null
  inJapan: boolean
  episode: string | null
  /** 未格式化的场景秒数；卡片侧用 formatSceneTime 转 mm:ss */
  scene: string | null
  /** 动画截图原始 URL（未归一） */
  image: string | null
  /** 有坐标却没拿到地址（上游未回 / 预算耗尽）：HTTP 层据此把公共缓存收到 5 分钟 */
  addressPending: boolean
}

/**
 * 点位上下文的读取与地理编码回填。HTTP handler 与卡片 handler 共用这一份，
 * 卡片路由据此不用打自己一次 HTTP。限流与响应头留在 HTTP 层，这里不做。
 */
export async function loadPointContext(
  deps: PointContextDeps,
  pointId: string,
  locale: SupportedLocale,
): Promise<LoadedPointContext | null> {
  const now = deps.now()
  // 点位与地址缓存并发读，串行会白等一个 RTT
  const [point, addressRow] = await Promise.all([
    deps.repo.findPoint(pointId, locale),
    deps.repo.findAddress(pointId),
  ])
  if (!point) return null

  const rawName = String(point.localizedName || point.name || '').trim()
  // animeTitle 兜底按 locale 定：localized i18n 标题 → bangumi 标题列（ja: jaRaw→original；
  // en: english→romaji；zh: zh）→ candidates[0]
  const localeFallback = point.localizedBangumiTitle
    ?? (locale === 'ja'
      ? point.bangumiTitles.jaRaw || point.bangumiTitles.original
      : locale === 'en'
        ? point.bangumiTitles.english || point.bangumiTitles.romaji
        : point.bangumiTitles.zh)
  const animeTitle = String(localeFallback || point.bangumiTitleCandidates[0] || '').trim()
  const candidates = [point.localizedBangumiTitle, ...point.bangumiTitleCandidates].filter(
    (value): value is string => Boolean(value && value.trim()),
  )
  const displayName = stripAnimeTitlePrefix(rawName, candidates)
  const note = String(point.localizedNote || point.mark || '').trim() || null
  const geo: [number, number] | null =
    point.geoLat != null && point.geoLng != null ? [point.geoLat, point.geoLng] : null
  const inJapan = geo ? isInJapan(geo[0], geo[1]) : false

  let address = pickAddress(addressRow, locale)
  if (!address && geo) {
    // 全局日预算：当日已回填的行数用完就不再打上游，address 留 null 按短缓存返回
    const utcDayStart = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000)
    const resolvedToday = await deps.repo.countResolvedSince(utcDayStart)
    if (resolvedToday < DAILY_GEOCODE_BUDGET) {
      const resolved = await deps.geocode({ lat: geo[0], lng: geo[1], includeCountry: !inJapan })
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
  }

  return {
    bangumiId: point.bangumiId,
    displayName,
    animeTitle,
    address,
    geo,
    note,
    inJapan,
    episode: point.ep,
    scene: point.scene,
    image: point.image,
    addressPending: Boolean(geo && !address),
  }
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

    const loaded = await loadPointContext(deps, pointId, locale)
    if (!loaded) return NextResponse.json({ error: '点位不存在' }, { status: 404 })

    const body: PointContextResponse = {
      address: loaded.address,
      geo: loaded.geo,
      note: loaded.note,
      inJapan: loaded.inJapan,
      displayName: loaded.displayName,
      animeTitle: loaded.animeTitle,
    }
    // 有坐标却没拿到地址（上游未回/预算耗尽）：可能是暂时性失败，公共缓存只敢放 5 分钟
    const cacheControl = loaded.addressPending ? 'public, max-age=300' : 'public, max-age=86400'
    return NextResponse.json(body, {
      status: 200,
      headers: { 'cache-control': cacheControl },
    })
  }
}
