import { normalizeText, toNumberOrNull } from '@/lib/anitabi/utils'

export type RawBangumi = {
  id?: number
  cn?: string
  title?: string
  cat?: string
  cover?: string
  description?: string
  color?: string
  city?: string
  tags?: string[]
  modified?: number
  geo?: [number, number]
  zoom?: number
}

export type RawLite = {
  id?: number
  cn?: string
  title?: string
  city?: string
  cover?: string
  color?: string
  modified?: number
  pointsLength?: number
  imagesLength?: number
  litePoints?: Array<{
    id?: string
    name?: string
    cn?: string
    image?: string
    geo?: [number, number]
  }>
}

export type RawPointsSummary = {
  points?: Array<Record<string, unknown>>
  customEPNames?: Record<string, string>
  theme?: unknown
  logs?: unknown
  removedPoints?: unknown
  completeness?: unknown
}

export type RawPointDetail = {
  id?: string
  name?: string
  cn?: string
  ep?: string | number
  s?: string | number
  image?: string
  geo?: [number, number]
  origin?: string
  originURL?: string
  originLink?: string
}

export type NormalizedBangumi = {
  id: number
  titleZh: string
  titleJaRaw: string
  cat: string | null
  cover: string | null
  description: string | null
  color: string | null
  city: string | null
  tags: string[]
  sourceModifiedMs: bigint | null
  geoLat: number | null
  geoLng: number | null
  zoom: number | null
}

export type NormalizedPoint = {
  id: string
  bangumiId: number
  name: string
  nameZh: string | null
  geoLat: number | null
  geoLng: number | null
  ep: string | null
  s: string | null
  image: string | null
  origin: string | null
  originUrl: string | null
  originLink: string | null
  density: number | null
  mark: string | null
  folder: string | null
  uid: string | null
  reviewUid: string | null
}

function safeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .map((v) => normalizeText(v))
    .filter(Boolean)
    .slice(0, 200)
}

function parseGeo(input: unknown): { lat: number | null; lng: number | null } {
  if (!Array.isArray(input) || input.length < 2) return { lat: null, lng: null }
  const lat = toNumberOrNull(input[0])
  const lng = toNumberOrNull(input[1])
  return { lat, lng }
}

function parseSafeInt32(input: unknown): number | null {
  const n = toNumberOrNull(input)
  if (n == null) return null
  if (!Number.isInteger(n)) return null
  if (n > 2147483647 || n < -2147483648) return null
  return n
}

function scopedPointId(bangumiId: number, rawPointId: string): string {
  return `${bangumiId}:${rawPointId}`
}

export function normalizeBangumi(raw: RawBangumi): NormalizedBangumi {
  const id = Number(raw?.id)
  if (!Number.isFinite(id)) throw new Error('Invalid bangumi id')

  const zh = normalizeText(raw?.cn)
  const ja = normalizeText(raw?.title)
  const geo = parseGeo(raw?.geo)

  return {
    id,
    titleZh: zh || ja || `#${id}`,
    titleJaRaw: ja || zh || `#${id}`,
    cat: normalizeText(raw?.cat) || null,
    cover: normalizeText(raw?.cover) || null,
    description: normalizeText(raw?.description) || null,
    color: normalizeText(raw?.color) || null,
    city: normalizeText(raw?.city) || null,
    tags: safeStringList(raw?.tags),
    sourceModifiedMs: Number.isFinite(Number(raw?.modified)) ? BigInt(Number(raw?.modified)) : null,
    geoLat: geo.lat,
    geoLng: geo.lng,
    zoom: toNumberOrNull(raw?.zoom),
  }
}

export function normalizePoints(
  bangumiId: number,
  details: RawPointDetail[],
  summary?: RawPointsSummary | null
): NormalizedPoint[] {
  const pointSummary = new Map<string, Record<string, unknown>>()
  for (const row of summary?.points || []) {
    const id = normalizeText((row as any)?.id)
    if (!id) continue
    pointSummary.set(id, row)
  }

  const seen = new Set<string>()
  const out: NormalizedPoint[] = []

  for (const row of details || []) {
    const rawId = normalizeText(row?.id)
    if (!rawId || seen.has(rawId)) continue
    seen.add(rawId)

    const extra = pointSummary.get(rawId) || {}
    const geoRaw = Array.isArray(row?.geo) ? row?.geo : (extra as any)?.geo
    const geo = parseGeo(geoRaw)

    out.push({
      id: scopedPointId(bangumiId, rawId),
      bangumiId,
      name: normalizeText(row?.name) || normalizeText((extra as any)?.name) || rawId,
      nameZh: normalizeText(row?.cn) || normalizeText((extra as any)?.cn) || null,
      geoLat: geo.lat,
      geoLng: geo.lng,
      ep: normalizeText(row?.ep) || normalizeText((extra as any)?.ep) || null,
      s: normalizeText(row?.s) || normalizeText((extra as any)?.s) || null,
      image: normalizeText(row?.image) || normalizeText((extra as any)?.image) || null,
      origin: normalizeText(row?.origin) || normalizeText((extra as any)?.origin) || null,
      originUrl: normalizeText(row?.originURL) || normalizeText((extra as any)?.originURL) || null,
      originLink: normalizeText(row?.originLink) || normalizeText((extra as any)?.originLink) || null,
      density: parseSafeInt32((extra as any)?.density),
      mark: normalizeText((extra as any)?.mark) || null,
      folder: normalizeText((extra as any)?.folder) || null,
      uid: normalizeText((extra as any)?.uid) || null,
      reviewUid: normalizeText((extra as any)?.reviewUid) || null,
    })
  }

  return out
}

export function getLiteStats(lite: RawLite | null): { pointsLength: number; imagesLength: number } {
  const pointsLength = Number.isFinite(Number(lite?.pointsLength)) ? Number(lite?.pointsLength) : 0
  const imagesLength = Number.isFinite(Number(lite?.imagesLength)) ? Number(lite?.imagesLength) : 0
  return { pointsLength, imagesLength }
}

export function normalizeContributorsFromUsersRaw(raw: unknown): Array<{
  id: string
  name: string | null
  avatar: string | null
  link: string | null
  payload: unknown
}> {
  const out: Array<{
    id: string
    name: string | null
    avatar: string | null
    link: string | null
    payload: unknown
  }> = []

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const id = normalizeText((item as any)?.id || (item as any)?.uid || (item as any)?.name)
      if (!id) continue
      out.push({
        id,
        name: normalizeText((item as any)?.name) || null,
        avatar: normalizeText((item as any)?.avatar) || null,
        link: normalizeText((item as any)?.url || (item as any)?.link) || null,
        payload: item,
      })
    }
    return out
  }

  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const id = normalizeText((value as any)?.id || key)
      if (!id) continue
      out.push({
        id,
        name: normalizeText((value as any)?.name || (value as any)?.nickname) || null,
        avatar: normalizeText((value as any)?.avatar) || null,
        link: normalizeText((value as any)?.url || (value as any)?.link) || null,
        payload: value,
      })
    }
  }

  return out
}
