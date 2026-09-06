import type { Prisma } from '@prisma/client'
import type { PlanAgentToolDeps } from './tools'
import { computeDepartureEpochSec, DAY_START_MIN } from './schedule'
import { queryTravelBetween } from './travelQuery'
import {
  countGoogleCall,
  createEnrichBudget,
  modelDirectionsCap,
  modelPlacesCap,
  rollEnrichBudgetWindow,
  type EnrichBudget,
} from './enrich/types'
import { computeHeuristicTransitCore } from './enrich/heuristicTransit'
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
    const resolved = (await deps.places?.lookup(input.placeId)) ?? null
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

/** 站内点位批量可解析性检查（save_plan_days 的"缺坐标可路由条目"防线）；precomputed 传入已批量查询的坐标时复用，避免重复查库 */
export async function assertPointsResolvable(
  pointIds: string[],
  deps: PlanAgentToolDeps,
  bangumiIds: number[],
  precomputed?: Array<{ id: string; lat: number; lng: number; image?: string | null }>,
): Promise<string[] | null> {
  if (!pointIds.length) return null
  const coords = precomputed ?? (await deps.points.getPointsByIds(pointIds, bangumiIds))
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

// ---------------------------------------------------------------------------
// estimate_travel 工具实现（从 tools.ts 拆出：行数预算）。查询 + transportPayload
// 组装（含日本公交兜底）在 travelQuery.ts，与 transportEnricher 共用。
// ---------------------------------------------------------------------------

/** 工具返回的预算耗尽提示（N4 + A5）：引导立即保存，服务端会用参考估算补齐交通 */
export const BUDGET_EXHAUSTED_MESSAGE =
  '本回合外部查询预算已用完，请立即保存当前进度；服务端会用参考估算补齐交通并在下一回合继续完善'
export const BUDGET_EXHAUSTED_RESULT = { error: BUDGET_EXHAUSTED_MESSAGE, code: 'budget_exhausted' }

/**
 * resolve_place / find_restaurants 共享的预算检查（A5）：先滚动 60s 时间窗，
 * 再按"模型上限 = places.max - 2（预留补齐脚本）"判定是否返回 budget_exhausted。
 */
export function placesToolBudgetExhausted(budget: EnrichBudget): boolean {
  rollEnrichBudgetWindow(budget)
  return budget.places.used >= modelPlacesCap(budget)
}

/** estimate_travel 工具主体；tools.ts 只做分发 */
export async function runEstimateTravelTool(deps: PlanAgentToolDeps, args: Record<string, unknown>): Promise<string> {
  const rawMode = String(args.mode ?? '')
  if (rawMode !== 'walk' && rawMode !== 'transit' && rawMode !== 'driving') {
    return JSON.stringify({ error: 'mode 必须是 walk / transit / driving 之一' })
  }
  const mode = rawMode as 'walk' | 'transit' | 'driving'
  if (!deps.travel) {
    return JSON.stringify({ error: '真实交通查询服务未配置（GOOGLE_DIRECTIONS_API_KEY 缺失），请改用 estimate_transit 兜底并向用户说明是估算值' })
  }
  // N4：模型工具调用与 enricher 共享同一 run 的 directions 预算（deps.enrichBudget
  // 由 loop 每个 run 创建一次）。A5：预留 4 次给补齐脚本（模型上限 max-4）；
  // 检查前先滚动时间窗（距窗口开始 ≥60s 时 used 归零）
  const budget: EnrichBudget = deps.enrichBudget ?? createEnrichBudget()
  rollEnrichBudgetWindow(budget)
  if (budget.directions.used >= modelDirectionsCap(budget)) {
    return JSON.stringify(BUDGET_EXHAUSTED_RESULT)
  }
  const plan = await deps.repo.getPlan(deps.planId)
  if (!plan) return JSON.stringify({ error: '计划不存在' })
  const from = await resolveTravelEndpoint(args.from, plan, deps, '起点')
  if ('error' in from) return JSON.stringify({ error: from.error })
  const to = await resolveTravelEndpoint(args.to, plan, deps, '终点')
  if ('error' in to) return JSON.stringify({ error: to.error })

  // 精确日期 → 真实出发时刻；模糊日期不传 departure_time（Google 按当前典型班次）
  let departureTimeSec: number | undefined
  let dateNote = '计划尚未确定精确日期，按典型时段估算；确定日期后可重查'
  const dayIndex = Number(args.dayIndex)
  if (plan.startDate && Number.isFinite(dayIndex) && dayIndex >= 1) {
    const departureMatch = /^(\d{1,2}):(\d{2})$/.exec(String(args.departureTime ?? '').trim())
    const hours = departureMatch ? Math.min(23, Number(departureMatch[1])) : Math.floor(DAY_START_MIN / 60)
    const minutesOfHour = departureMatch ? Math.min(59, Number(departureMatch[2])) : DAY_START_MIN % 60
    const minutes = hours * 60 + minutesOfHour
    const epoch = computeDepartureEpochSec(plan.startDate, dayIndex, minutes)
    if (epoch !== null) {
      departureTimeSec = epoch
      dateNote = `已按第 ${Math.floor(dayIndex)} 天 ${String(hours).padStart(2, '0')}:${String(minutesOfHour).padStart(2, '0')}（当地）的真实日期查询`
    }
  }

  const outcome = await queryTravelBetween(
    {
      travel: deps.travel,
      // 真实外呼计数：与 transport enricher 同一份预算（N4）
      onGoogleCall: () => countGoogleCall(budget, 'directions'),
    },
    { from, to, mode, departureTimeSec },
  )
  if (!outcome.ok) {
    return JSON.stringify({
      error: outcome.message,
      code: outcome.code,
      ...(outcome.code === 'zero_results'
        ? { hint: '用 ask_user（taskType=opinion，kind=single_choice）问用户：改自驾/租车、坚持公共交通、混合方式或自行输入——这是意见题，不要当作品选择（taskType=work_selection）发起' }
        : {}),
    })
  }
  return JSON.stringify({ ...outcome.response, dateNote })
}

/**
 * estimate_transit 工具主体（旧版本地启发式，≤1.5km 步行其余公交）。兜底结果
 * 也要能过出处门并让前端标注"参考估算"：返回 provider/estimated 与完整
 * transportPayload（形状同 queryTravelBetween 的估算分支），模型把它原样
 * 写进 transit 条目 payload.transport 即可。
 */
export async function runEstimateTransitTool(deps: PlanAgentToolDeps, args: Record<string, unknown>): Promise<string> {
  const fromId = String(args.fromPointId ?? '')
  const toId = String(args.toPointId ?? '')
  const plan = await deps.repo.getPlan(deps.planId)
  const coords = await deps.points.getPointsByIds([fromId, toId], plan?.bangumiIds ?? [])
  // 容忍容错层返回的完整 scoped id（请求裸 id、命中带前缀形式）
  const from = coords.find((p) => p.id === fromId || p.id.endsWith(`:${fromId}`))
  const to = coords.find((p) => p.id === toId || p.id.endsWith(`:${toId}`))
  if (!from || !to) return JSON.stringify({ error: '点位不存在或缺少坐标' })
  // A5：数值推算与 transport enricher 的零外呼估算同源（heuristicTransit.ts）
  const { mode, durationMin, distanceKm, mapsUrl } = computeHeuristicTransitCore(from, to)
  const note = '外部交通查询服务不可用，此为按直线距离推算的参考估算值；仅供参考'
  const transportPayload = {
    mode,
    durationMin,
    distanceKm,
    transfers: null,
    provider: 'estimate',
    estimated: true,
    source: 'heuristic',
    note,
    mapsUrl,
    fetchedAt: new Date().toISOString(),
    legs: [],
  }
  return JSON.stringify({ distanceKm, mode, durationMin, estimated: true, provider: 'estimate', note, mapsUrl, transportPayload })
}
