import type { SupportedLocale } from '@/lib/i18n/types'
import type { AnitabiPointDTO } from '@/lib/anitabi/types'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { getBangumiDetail } from '@/lib/anitabi/read'
import { normalizeText } from '@/lib/anitabi/utils'
import { getSiteOrigin } from '@/lib/seo/site'
import { resolveMirrorPublicUrl } from '@/lib/anitabi/imageProxy'

export type SearchParamsInput = Record<string, string | string[] | undefined>

export type MapShareQuery = {
  b: number | null
  p: string | null
}

export type MapShareSnapshot = {
  bangumiId: number
  bangumiTitle: string
  bangumiCity: string | null
  bangumiColor: string | null
  /** 作品封面原始 URL（未归一），给 OG 回退用 */
  bangumiCover: string | null
  pointsLength: number
  pointId: string | null
  pointName: string | null
  pointEp: string | null
  pointScene: string | null
  pointGeo: [number, number] | null
  /** 点位动画截图原始 URL（未归一），给 OG 首选用 */
  pointImage: string | null
}

function parsePositiveInt(value: string | null | undefined): number | null {
  const n = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function matchPointId(candidateId: string, pointId: string): boolean {
  if (candidateId === pointId) return true
  if (pointId.includes(':')) return false
  return candidateId.endsWith(`:${pointId}`)
}

function toPointGeo(point: AnitabiPointDTO | null): [number, number] | null {
  if (!point?.geo) return null
  const [lat, lng] = point.geo
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return [lat, lng]
}

function pickPoint(points: AnitabiPointDTO[], pointId: string | null): AnitabiPointDTO | null {
  if (!pointId) return null
  return points.find((point) => matchPointId(point.id, pointId)) || null
}

export function toUrlSearchParams(input: URLSearchParams | SearchParamsInput | null | undefined): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input)

  const params = new URLSearchParams()
  if (!input) return params

  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = normalizeText(item)
        if (!text) continue
        params.append(key, text)
      }
      continue
    }

    const text = normalizeText(value)
    if (!text) continue
    params.set(key, text)
  }

  return params
}

export function parseMapShareQuery(input: URLSearchParams | SearchParamsInput | null | undefined): MapShareQuery {
  const params = toUrlSearchParams(input)
  const p = normalizeText(params.get('p')) || null

  let b = parsePositiveInt(params.get('b'))
  if (b == null && p && p.includes(':')) {
    const [prefix] = p.split(':')
    b = parsePositiveInt(prefix)
  }

  return {
    b,
    p,
  }
}

/**
 * 地图页 / 短链页的 OG 图：点位动画截图 → 作品封面 → 站点默认 OG。
 * 前两级都走 R2 公共域直出（resolveMirrorPublicUrl，key 与镜像入库零漂移）；
 * 开关未配（NEXT_PUBLIC_MAP_IMAGE_R2_PUBLIC_BASE 为空）时它返回 null，自然落到默认 OG。
 */
export async function buildMapShareImageUrl(
  locale: SupportedLocale,
  query: MapShareQuery,
): Promise<string> {
  const fallback = `${getSiteOrigin()}/opengraph-image`
  if (query.b == null) return fallback

  const snapshot = await resolveMapShareSnapshot(locale, query)
  if (!snapshot) return fallback

  if (snapshot.pointImage) {
    const url = await resolveMirrorPublicUrl(snapshot.pointImage, { kind: 'point' })
    if (url) return url
  }
  if (snapshot.bangumiCover) {
    const url = await resolveMirrorPublicUrl(snapshot.bangumiCover, { kind: 'cover' })
    if (url) return url
  }
  return fallback
}

export async function resolveMapShareSnapshot(locale: SupportedLocale, query: MapShareQuery): Promise<MapShareSnapshot | null> {
  if (query.b == null) return null

  try {
    const deps = await getAnitabiApiDeps()
    const detail = await getBangumiDetail({
      prisma: deps.prisma,
      id: query.b,
      locale,
    })
    if (!detail) return null

    const point = pickPoint(detail.points, query.p)
    return {
      bangumiId: detail.card.id,
      bangumiTitle: detail.card.title,
      bangumiCity: detail.card.city || null,
      bangumiColor: detail.card.color || null,
      bangumiCover: detail.card.cover || null,
      pointsLength: detail.points.length,
      pointId: point?.id || null,
      pointName: point?.name || null,
      pointEp: point?.ep || null,
      pointScene: point?.s || null,
      pointGeo: toPointGeo(point),
      pointImage: point?.image || null,
    }
  } catch {
    return null
  }
}
