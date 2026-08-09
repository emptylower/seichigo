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
  /**
   * /lite 实际会返回 geo 与 zoom，此前漏了声明。
   * 端点收敛后 /lite 是作品元数据的唯一来源，这两个字段必须走它。
   */
  geo?: [number, number]
  zoom?: number
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

/**
 * 端点收敛后 /lite 成为作品元数据的唯一来源，但它不返回 cat / description / tags
 * （原先来自未授权的 /bangumi/{id}）。这三个字段现在**没有上游来源**，
 * 必须区分「上游没给这个字段」与「上游给了空值」—— 否则同步会把库里已有的值抹掉。
 * 缺失的字段在 upsert 时整个跳过（见 workflow.ts 的 pickRenewable）。
 */
export type NormalizedBangumiFromLite = Omit<NormalizedBangumi, 'cat' | 'description' | 'tags'>

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
  /**
   * 以下 5 个字段原先只来自未授权的 /bangumi/{id}/points 摘要端点，该端点已停用。
   * 官方 API 无法再取回它们 —— 库里现存的值是**不可再生资源**。
   * 因此类型是 `| undefined`（无摘要时不产出该键），调用方据此整个跳过、不写库；
   * 若用 `null` 会在 upsert 时把已有值抹成空，且无法恢复。
   */
  density?: number | null
  mark?: string | null
  folder?: string | null
  uid?: string | null
  reviewUid?: string | null
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

/**
 * 从官方 /bangumi/{id}/lite 归一作品元数据。
 *
 * 端点收敛后这是唯一的作品数据来源。刻意**不产出** cat / description / tags ——
 * /lite 不返回它们，若在此填 null 会在 upsert 时把库里已有值抹掉。
 * 调用方据此只更新本函数返回的字段。
 */
export function normalizeBangumiFromLite(raw: RawLite): NormalizedBangumiFromLite {
  const id = Number(raw?.id)
  if (!Number.isFinite(id)) throw new Error('Invalid bangumi id')

  const zh = normalizeText(raw?.cn)
  const ja = normalizeText(raw?.title)
  const geo = parseGeo(raw?.geo)

  return {
    id,
    titleZh: zh || ja || `#${id}`,
    titleJaRaw: ja || zh || `#${id}`,
    cover: normalizeText(raw?.cover) || null,
    color: normalizeText(raw?.color) || null,
    city: normalizeText(raw?.city) || null,
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

  const pointDetail = new Map<string, RawPointDetail>()
  for (const row of details || []) {
    const id = normalizeText(row?.id)
    if (!id || pointDetail.has(id)) continue
    pointDetail.set(id, row)
  }

  const orderedIds: string[] = []
  const seenIds = new Set<string>()
  for (const row of summary?.points || []) {
    const id = normalizeText((row as any)?.id)
    if (!id || seenIds.has(id)) continue
    seenIds.add(id)
    orderedIds.push(id)
  }
  for (const [id] of pointDetail) {
    if (seenIds.has(id)) continue
    seenIds.add(id)
    orderedIds.push(id)
  }

  const out: NormalizedPoint[] = []
  // 没有摘要时（端点已停用，常态如此），不可再生的 5 个字段整个不产出键，
  // 让调用方跳过写入而不是覆盖成 null。
  const hasSummary = Boolean(summary?.points)

  for (const rawId of orderedIds) {
    const row = pointDetail.get(rawId)
    const extra = pointSummary.get(rawId) || {}
    const geoRaw = Array.isArray(row?.geo) ? row.geo : (extra as any)?.geo
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
      ...(hasSummary
        ? {
            density: parseSafeInt32((extra as any)?.density),
            mark: normalizeText((extra as any)?.mark) || null,
            folder: normalizeText((extra as any)?.folder) || null,
            uid: normalizeText((extra as any)?.uid) || null,
            reviewUid: normalizeText((extra as any)?.reviewUid) || null,
          }
        : {}),
    })
  }

  return out
}

/**
 * 上游自报的点位/图片数量。
 *
 * 刻意区分「上游没给这个字段」（null）与「上游明确说是 0」（0）——
 * 前者不能当作真实计数：它既会把 meta 里的真实数字覆盖成 0，
 * 也会让点位删除闸门误以为「上游声称 0 个点位」而放行删除。
 */
export function getLiteStats(lite: RawLite | null): {
  pointsLength: number | null
  imagesLength: number | null
} {
  const rawPoints = lite?.pointsLength
  const rawImages = lite?.imagesLength
  return {
    pointsLength: rawPoints == null || !Number.isFinite(Number(rawPoints)) ? null : Number(rawPoints),
    imagesLength: rawImages == null || !Number.isFinite(Number(rawImages)) ? null : Number(rawImages),
  }
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
