import type { Prisma } from '@prisma/client'
import type { PlanAgentToolDeps } from './tools'
import { isSafePlacePhotoDisplayUrl } from '@/lib/googlePlaces/places'
import { isSafeAskOptionImageUrl } from './askUser'

/**
 * estimate_travel / resolve_place / save_plan_days 共用的端点解析与载荷整理助手。
 * 从 tools.ts 拆出（行数预算），语义见 M3 执行简报 §5/§7。
 */

/** 计划内外部地点的规范化摘要（出处验证用） */
export type PlanPlaceSummary = {
  lat: number
  lng: number
  name: string
  provider?: string
}

/** 从计划现有条目里收集外部地点（payload.place），供 placeId 端点解析与去重 */
export function collectPlanPlaces(
  plan: { days: Array<{ items: Array<{ payload?: Prisma.JsonValue | null }> }> } | null,
): Map<string, PlanPlaceSummary> {
  const map = new Map<string, PlanPlaceSummary>()
  for (const day of plan?.days ?? []) {
    for (const item of day.items) {
      const payload = item.payload
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) continue
      const place = (payload as Record<string, unknown>).place
      if (typeof place !== 'object' || place === null) continue
      const record = place as Record<string, unknown>
      const placeId = typeof record.placeId === 'string' ? record.placeId : null
      const lat = Number(record.lat)
      const lng = Number(record.lng)
      const name = typeof record.name === 'string' ? record.name : ''
      if (placeId && Number.isFinite(lat) && Number.isFinite(lng)) {
        map.set(placeId, {
          lat,
          lng,
          name,
          ...(typeof record.provider === 'string' ? { provider: record.provider } : {}),
        })
      }
    }
  }
  return map
}

const PLACE_COORD_TOLERANCE = 1e-6

/**
 * 校验待落库的 payload.place 与出处（resolver 缓存或计划内已持久化数据）逐字段
 * 一致：provider/name 精确相等，lat/lng 容差 1e-6。防止只验证 placeId 存在、
 * 却偷换坐标/名称的篡改。返回 null 表示一致；否则返回中文错误。
 */
export function verifyPlaceAgainstCanonical(
  candidate: { provider?: unknown; name?: unknown; lat?: unknown; lng?: unknown },
  canonical: { provider?: string; name: string; lat: number; lng: number },
): string | null {
  const name = typeof candidate.name === 'string' ? candidate.name : ''
  if (name !== canonical.name) {
    return `name 与原始解析结果不一致（应为「${canonical.name}」）——请原样照抄工具返回的 place`
  }
  if (typeof canonical.provider === 'string' && String(candidate.provider ?? '') !== canonical.provider) {
    return `provider 应为「${canonical.provider}」——请原样照抄工具返回的 place`
  }
  const lat = Number(candidate.lat)
  const lng = Number(candidate.lng)
  if (!Number.isFinite(lat) || Math.abs(lat - canonical.lat) > PLACE_COORD_TOLERANCE) {
    return `lat 与原始解析结果不一致（应为 ${canonical.lat}）——坐标不可改动`
  }
  if (!Number.isFinite(lng) || Math.abs(lng - canonical.lng) > PLACE_COORD_TOLERANCE) {
    return `lng 与原始解析结果不一致（应为 ${canonical.lng}）——坐标不可改动`
  }
  return null
}

export type PlanLikeForTravel = {
  bangumiIds: number[]
  days: Array<{ items: Array<{ payload?: Prisma.JsonValue | null }> }>
} | null

type TravelEndpointInput = { pointId?: string; placeId?: string; lat?: number; lng?: number }

/**
 * 把端点参数解析成坐标：pointId（站内点位，含裸 id 容错）/ placeId（计划内
 * 已保存的外部地点）/ 直接坐标。解析失败返回中文错误供模型自纠。
 */
export async function resolveTravelEndpoint(
  endpoint: unknown,
  plan: PlanLikeForTravel,
  deps: PlanAgentToolDeps,
  label: string,
): Promise<{ lat: number; lng: number } | { error: string }> {
  const raw =
    typeof endpoint === 'object' && endpoint !== null ? (endpoint as Record<string, unknown>) : {}
  const input: TravelEndpointInput = {
    ...(typeof raw.pointId === 'string' && raw.pointId ? { pointId: raw.pointId } : {}),
    ...(typeof raw.placeId === 'string' && raw.placeId ? { placeId: raw.placeId } : {}),
    ...(Number.isFinite(Number(raw.lat)) ? { lat: Number(raw.lat) } : {}),
    ...(Number.isFinite(Number(raw.lng)) ? { lng: Number(raw.lng) } : {}),
  }

  if (input.pointId) {
    const coords = await deps.points.getPointsByIds([input.pointId], plan?.bangumiIds ?? [])
    const hit = coords.find((p) => p.id === input.pointId || p.id.endsWith(`:${input.pointId}`))
    if (!hit) return { error: `${label}点位不存在或缺少坐标（需要 list_points 返回的完整 id）` }
    return { lat: hit.lat, lng: hit.lng }
  }
  if (input.placeId) {
    // 标准工作流（resolve_place → estimate_travel → save_plan_days）不需要中间
    // 落库：当前计划的 resolver 缓存（resolve_place 刚解析的）或已持久化的
    // payload.place 都足以证明并取到坐标
    const resolved = deps.places?.lookup(input.placeId) ?? null
    if (resolved) return { lat: resolved.lat, lng: resolved.lng }
    const persisted = collectPlanPlaces(plan).get(input.placeId)
    if (persisted) return { lat: persisted.lat, lng: persisted.lng }
    return { error: `${label}placeId 未在当前计划中解析过——先用 resolve_place 解析该地点后再引用` }
  }
  if (input.lat !== undefined && input.lng !== undefined) {
    if (Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) return { error: `${label}坐标超出合法范围` }
    return { lat: input.lat, lng: input.lng }
  }
  return { error: `${label}端点缺少 pointId/placeId/坐标` }
}

/** Google step → 模型可读的紧凑分段摘要（线路/上下车站/站数/时刻） */
export function summarizeLegForModel(step: {
  travelMode: string
  instruction: string
  durationSeconds: number
  distanceMeters: number
  transitDetails:
    | {
        lineName: string
        departureStop: string
        arrivalStop: string
        numStops: number
        departureTime?: string
        arrivalTime?: string
      }
    | null
}) {
  return {
    mode: step.travelMode === 'WALKING' ? 'walk' : step.travelMode === 'DRIVING' ? 'drive' : 'transit',
    durationMin: Math.max(1, Math.round(step.durationSeconds / 60)),
    distanceKm: Math.round((step.distanceMeters / 1000) * 10) / 10,
    instruction: step.instruction.slice(0, 160),
    ...(step.transitDetails
      ? {
          line: step.transitDetails.lineName,
          fromStop: step.transitDetails.departureStop,
          toStop: step.transitDetails.arrivalStop,
          numStops: step.transitDetails.numStops,
          ...(step.transitDetails.departureTime ? { departureTime: step.transitDetails.departureTime } : {}),
          ...(step.transitDetails.arrivalTime ? { arrivalTime: step.transitDetails.arrivalTime } : {}),
        }
      : {}),
  }
}

const TRANSPORT_PAYLOAD_MAX_JSON_LENGTH = 24_000
const TRANSPORT_MAX_LEGS = 40
const TRANSPORT_MAX_POLYLINE_POINTS = 400

/** 限制 payload.transport 的体积：先裁 polyline，再裁 legs，保证 JSON 可控 */
export function sanitizeTransportPayload(payload: Record<string, unknown>): void {
  const transport = payload.transport
  if (typeof transport !== 'object' || transport === null || Array.isArray(transport)) return
  const record = transport as Record<string, unknown>
  if (Array.isArray(record.legs) && record.legs.length > TRANSPORT_MAX_LEGS) {
    record.legs = record.legs.slice(0, TRANSPORT_MAX_LEGS)
  }
  if (Array.isArray(record.polyline) && record.polyline.length > TRANSPORT_MAX_POLYLINE_POINTS) {
    record.polyline = record.polyline.slice(0, TRANSPORT_MAX_POLYLINE_POINTS)
  }
  const size = () => JSON.stringify(payload).length
  if (size() > TRANSPORT_PAYLOAD_MAX_JSON_LENGTH) delete record.polyline
  if (size() > TRANSPORT_PAYLOAD_MAX_JSON_LENGTH && Array.isArray(record.legs)) {
    record.legs = (record.legs as unknown[]).slice(0, 12)
  }
}

/** 站内点位批量可解析性检查（save_plan_days 的"缺坐标可路由条目"防线） */
export async function assertPointsResolvable(
  pointIds: string[],
  deps: PlanAgentToolDeps,
  bangumiIds: number[],
): Promise<string[] | null> {
  if (!pointIds.length) return null
  const coords = await deps.points.getPointsByIds(pointIds, bangumiIds)
  const resolved = new Set<string>()
  for (const p of coords) {
    resolved.add(p.id)
    const sep = p.id.indexOf(':')
    if (sep >= 0) resolved.add(p.id.slice(sep + 1))
  }
  const missing = pointIds.filter((id) => !resolved.has(id))
  return missing.length ? missing : null
}

/**
 * save_plan_days 的窄防线（M3 容错）：模型经常只把 resolve_place 的 place 原样
 * 放进 payload.place、漏掉单独的 media，导致外部地点落库后 Daymap 卡片无图、
 * Google photo proxy/R2 不被触发。当条目通过 place 出处校验（调用方保证）、
 * payload.media 缺失或 displayUrl 无效、而 place.photo.displayUrl 是安全的站内
 * Google photo 代理 URL 时，就地派生 payload.media。
 *
 * 边界：模型已提供合法 media 时保持其值与优先级；place.photo 的 URL 不安全
 * （任意外部地址/带密钥）绝不注入；transit 条目不走此防线（其 place 未过出处校验）。
 * 失败一律静默降级为"无图"，不打断既有错误路径。
 */
export function derivePlaceMedia(payload: Record<string, unknown>, itemType: string): void {
  if (itemType === 'transit') return
  const place = payload.place
  if (!place || typeof place !== 'object' || Array.isArray(place)) return
  const placeRecord = place as Record<string, unknown>
  const photo = placeRecord.photo
  if (!photo || typeof photo !== 'object' || Array.isArray(photo)) return
  const photoRecord = photo as Record<string, unknown>
  const photoDisplayUrl = typeof photoRecord.displayUrl === 'string' ? photoRecord.displayUrl : ''
  if (!isSafePlacePhotoDisplayUrl(photoDisplayUrl)) return

  // 模型已提供合法 media（displayUrl 安全）→ 保持其值与优先级
  const media = payload.media
  if (media && typeof media === 'object' && !Array.isArray(media)) {
    const mediaDisplayUrl = (media as Record<string, unknown>).displayUrl
    if (typeof mediaDisplayUrl === 'string' && isSafeAskOptionImageUrl(mediaDisplayUrl)) return
  }

  payload.media = {
    source: 'google_places',
    displayUrl: photoDisplayUrl,
    ...(typeof photoRecord.attribution === 'string' && photoRecord.attribution ? { attribution: photoRecord.attribution } : {}),
    ...(typeof photoRecord.photoReference === 'string' && photoRecord.photoReference ? { photoReference: photoRecord.photoReference } : {}),
  }
}
