import { isWithinJapan } from '@/lib/directions/googleClient'
import type { GoogleTravelMode, TravelResult } from '@/lib/directions/googleClient'

/**
 * estimate_travel 工具与 transportEnricher 共用的"查询 + transportPayload 组装"层
 * （M4 A2 从 travelHelpers.ts 拆出）：真实 Google Directions 查询、日本公交
 * 覆盖缺口兜底估算、模型可照抄的 transportPayload/legs 摘要都集中在这里。
 */

export type TravelQueryFn = (input: {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  mode: GoogleTravelMode
  departureTimeSec?: number
}) => Promise<TravelResult>

export type TravelQueryMode = 'walk' | 'transit' | 'driving'

/**
 * 统一查询结果：ok 时 response 是可直接 JSON.stringify 给模型的对象
 * （含 transportPayload；日本估算时还带 estimated/provider/note/mapsUrl，
 * 与 estimate_travel 工具的历史返回形状一致）；失败时给 code+message，
 * 由调用方决定如何提示（工具加 ask_user 引导，enricher 记 skipped）。
 */
export type TravelQueryOutcome =
  | { ok: true; response: Record<string, unknown> }
  | { ok: false; code?: string; message: string }

/** Google step → 模型可读的紧凑分段摘要（线路/上下车站/站数/时刻/方向） */
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
        headsign?: string
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
          ...(step.transitDetails.headsign ? { headsign: step.transitDetails.headsign } : {}),
        }
      : {}),
  }
}

export const JAPAN_TRANSIT_ESTIMATE_NOTE =
  'Google 路线服务不提供日本公共交通时刻，此为按道路距离推算的参考值；请以 Google 地图/乘换案内为准'

/** Google Maps 方向链接（transit 模式）：供前端"在 Google 地图查看"外链 */
export function buildTransitMapsUrl(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=transit`
}

/** 日本 transit 兜底推算（A1）：drivingMin × 1.3 + 12，四舍五入到分钟 */
export function estimateTransitMinutesFromDriving(drivingMin: number): number {
  return Math.max(1, Math.round(drivingMin * 1.3 + 12))
}

/** 自驾距离不高于此值（米）时，兜底直接改查步行（与 estimate_transit 阈值一致） */
const JAPAN_TRANSIT_WALK_THRESHOLD_M = 1_500

type JapanTransitFallback =
  | { status: 'travel'; result: Extract<TravelResult, { ok: true }>; mode: 'walk' }
  | { status: 'estimated'; response: Record<string, unknown> }
  | { status: 'unavailable' }

/**
 * 日本公交覆盖缺口兜底（A1）：transit ZERO_RESULTS 且起终点都在日本时，
 * 先补查一次自驾——距离 ≤ 1.5km 直接给真实步行结果；否则按道路距离推算
 * transit 参考值（provider 'estimate'）。自驾/步行补查失败返回 unavailable，
 * 由调用方回退到原有 zero_results + ask_user 行为（日本外完全不进入这里）。
 * 每次真实外呼（driving/walking）先经 onGoogleCall 计数再 await。
 */
export async function resolveJapanTransitFallback(input: {
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
  travel: TravelQueryFn
  departureTimeSec?: number
  onGoogleCall?: () => void
}): Promise<JapanTransitFallback> {
  input.onGoogleCall?.()
  const driving = await input.travel({
    origin: input.from,
    destination: input.to,
    mode: 'driving',
    departureTimeSec: input.departureTimeSec,
  })
  if (!driving.ok) return { status: 'unavailable' }
  if (driving.distanceMeters <= JAPAN_TRANSIT_WALK_THRESHOLD_M) {
    input.onGoogleCall?.()
    const walking = await input.travel({
      origin: input.from,
      destination: input.to,
      mode: 'walking',
      departureTimeSec: input.departureTimeSec,
    })
    if (!walking.ok) return { status: 'unavailable' }
    return { status: 'travel', result: walking, mode: 'walk' }
  }
  const mapsUrl = buildTransitMapsUrl(input.from, input.to)
  const durationMin = estimateTransitMinutesFromDriving(Math.max(1, Math.round(driving.durationSeconds / 60)))
  const distanceKm = Math.round((driving.distanceMeters / 1000) * 10) / 10
  return {
    status: 'estimated',
    response: {
      ok: true,
      mode: 'transit',
      estimated: true,
      provider: 'estimate',
      source: 'japan-fallback',
      durationMin,
      distanceKm,
      transfers: null,
      legs: [],
      note: JAPAN_TRANSIT_ESTIMATE_NOTE,
      mapsUrl,
      transportPayload: {
        mode: 'transit',
        durationMin,
        distanceKm,
        transfers: null,
        provider: 'estimate',
        estimated: true,
        source: 'japan-fallback',
        note: JAPAN_TRANSIT_ESTIMATE_NOTE,
        mapsUrl,
        fetchedAt: new Date().toISOString(),
        legs: [],
      },
    },
  }
}

/**
 * 两点之间的完整交通查询（工具与 enricher 共用）：真实查询 → 日本公交兜底 →
 * 组装 transportPayload/legs 摘要。绝不吞错——失败以 ok:false 交给调用方处置。
 * onGoogleCall 在每次真实外呼之前回调一次（含主查询与日本兜底的 driving/
 * walking 补查；抛错路径同样已计数），供 enricher 按真实外呼计量预算。
 */
export async function queryTravelBetween(
  deps: { travel: TravelQueryFn; onGoogleCall?: () => void },
  input: { from: { lat: number; lng: number }; to: { lat: number; lng: number }; mode: TravelQueryMode; departureTimeSec?: number },
): Promise<TravelQueryOutcome> {
  const googleMode: GoogleTravelMode = input.mode === 'walk' ? 'walking' : input.mode
  deps.onGoogleCall?.()
  let result = await deps.travel({ origin: input.from, destination: input.to, mode: googleMode, departureTimeSec: input.departureTimeSec })
  let resultMode: 'walk' | 'transit' | 'driving' = input.mode
  let japanEstimate: Record<string, unknown> | null = null
  // 日本公交覆盖缺口兜底（A1）：只有 transit 查空且起终点都在日本才推算，
  // 其他场景（含日本外）保持 zero_results 由调用方处置
  if (
    !result.ok &&
    result.code === 'zero_results' &&
    input.mode === 'transit' &&
    isWithinJapan(input.from.lat, input.from.lng) &&
    isWithinJapan(input.to.lat, input.to.lng)
  ) {
    const fallback = await resolveJapanTransitFallback({
      from: input.from,
      to: input.to,
      travel: deps.travel,
      departureTimeSec: input.departureTimeSec,
      onGoogleCall: deps.onGoogleCall,
    })
    if (fallback.status === 'travel') {
      result = fallback.result
      resultMode = fallback.mode
    } else if (fallback.status === 'estimated') {
      japanEstimate = fallback.response
    }
  }
  if (japanEstimate) return { ok: true, response: japanEstimate }
  if (!result.ok) return { ok: false, code: result.code, message: result.message }

  const legs = (result.legs ?? []).flatMap((leg) => leg.steps.map(summarizeLegForModel))
  const durationMin = Math.max(1, Math.round(result.durationSeconds / 60))
  const distanceKm = Math.round((result.distanceMeters / 1000) * 10) / 10
  const transportPayload = {
    mode: resultMode,
    durationMin,
    distanceKm,
    transfers: result.transfers,
    walkMin: Math.round(result.walkSeconds / 60),
    provider: 'google',
    source: 'google',
    fetchedAt: new Date().toISOString(),
    ...(input.departureTimeSec ? { departureEpoch: input.departureTimeSec } : {}),
    ...((result.polyline ?? []).length ? { polyline: result.polyline } : {}),
    legs,
  }
  return {
    ok: true,
    response: {
      ok: true,
      mode: resultMode,
      durationMin,
      distanceKm,
      transfers: result.transfers,
      walkMin: Math.round(result.walkSeconds / 60),
      googleMode: resultMode === 'walk' ? 'walking' : resultMode,
      source: 'google',
      legs,
      transportPayload,
    },
  }
}
