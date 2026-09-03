import { haversineKm } from '../cluster'
import { queryTravelBetween, type TravelQueryMode } from '../travelQuery'
import { buildHeuristicTransitPayload } from './heuristicTransit'
import type { EnrichContext, EnrichDay, EnrichReport, EnrichTravelMode } from './types'

/**
 * transport enricher：同一天相邻两个有坐标条目之间的交通补齐。
 *
 * - 缺行时插入 `{ type:'transit', payload.transport }`（真实查询优先）；
 * - A4：两坐标条目之间已存在 transit 行但载荷不合格（provider 空/无载荷，
 *   且不是 legacy 扁平载荷）→ 就地查询写入该行，不新插行、不重复；
 * - A5：Directions 预算耗尽、查询失败或服务未配置时，不再留空——写入
 *   直线距离估算（provider 'estimate' + source 'heuristic'，附 Google 地图
 *   公交深链）。estimate+heuristic 的行视为"待升级"，下一次保存有预算时
 *   会被真实查询替换（不算已合格交通，也不阻断插行/就地判定）；
 * - mode 取 ctx.travelMode（缺省 mixed：直线 ≤1.5km walking，否则 transit）；
 * - 预算按真实外呼计量（onGoogleCall 含日本兜底补查与抛错路径）。
 */

const MIXED_WALK_THRESHOLD_KM = 1.5

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function coordsOfItem(item: EnrichDay['items'][number], ctx: EnrichContext): { lat: number; lng: number } | null {
  if (item.pointId) {
    const hit = ctx.coordsByPointId.get(item.pointId)
    if (hit) return { lat: hit.lat, lng: hit.lng }
  }
  const place = asRecord(item.payload?.place)
  if (place) {
    const lat = Number(place.lat)
    const lng = Number(place.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
  }
  return null
}

function resolveMode(travelMode: EnrichTravelMode | undefined, from: { lat: number; lng: number }, to: { lat: number; lng: number }): TravelQueryMode {
  if (travelMode === 'walk' || travelMode === 'transit' || travelMode === 'driving') return travelMode
  // mixed / 缺省：短直线距离步行，否则公交
  return haversineKm(from, to) <= MIXED_WALK_THRESHOLD_KM ? 'walk' : 'transit'
}

/**
 * transit 行是否为就地补齐目标：provider 空 / 无载荷 / estimate+heuristic
 * （待升级）。legacy 扁平载荷（根上 mode/durationMin）与 provider 非空的
 * 合格行都不动。
 */
function isFillableTransitRow(item: EnrichDay['items'][number]): boolean {
  const transport = asRecord(item.payload?.transport)
  if (transport) {
    const provider = String(transport.provider ?? '')
    if (!provider) return true
    return provider === 'estimate' && transport.source === 'heuristic'
  }
  const payload = item.payload ?? {}
  const mode = typeof payload.mode === 'string' ? payload.mode.trim() : ''
  const durationMin = Number(payload.durationMin)
  return !(mode.length > 0 || (Number.isFinite(durationMin) && durationMin > 0))
}

type SegmentOutcome = { payload: Record<string, unknown> } | { skip: string }

/**
 * 解析一段交通：真实查询优先（预算内）；预算耗尽 / 查询失败 / 服务未配置时
 * 写入零外呼估算（A5 不留空）。唯一不写任何东西的分支是 ok 但缺
 * transportPayload 的防御路径（保持既有 skipped 行为）。
 */
async function resolveSegmentPayload(
  ctx: EnrichContext,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<SegmentOutcome> {
  const travel = ctx.deps.travel
  const budgetAvailable = !ctx.budget || ctx.budget.directions.used < ctx.budget.directions.max
  if (travel && budgetAvailable) {
    const mode = resolveMode(ctx.travelMode, from, to)
    try {
      const outcome = await queryTravelBetween(
        {
          travel,
          // 真实外呼计数：主查询与日本兜底补查（driving/walking）各一次，
          // 抛错路径同样计数（回调先于 await）
          onGoogleCall: () => {
            if (ctx.budget) ctx.budget.directions.used += 1
          },
        },
        { from, to, mode },
      )
      if (outcome.ok) {
        const transportPayload = (outcome.response as { transportPayload?: Record<string, unknown> }).transportPayload
        if (transportPayload) return { payload: transportPayload }
        return { skip: 'no_payload' }
      }
      // 查询失败（zero_results/provider_error…）→ 落到零外呼估算
    } catch {
      // 查询异常 → 落到零外呼估算
    }
  }
  return { payload: buildHeuristicTransitPayload(from, to) }
}

export async function runTransportEnricher(days: EnrichDay[], ctx: EnrichContext, report: EnrichReport): Promise<void> {
  for (const day of days) {
    let lastLabeled: { title: string; coords: { lat: number; lng: number } } | null = null
    let sawQualifiedTransit = false
    // A4：介于 lastLabeled 与下一坐标条目之间的待就地补齐 transit 行
    let pendingFill: EnrichDay['items'][number][] = []
    let index = 0
    while (index < day.items.length) {
      const item = day.items[index]
      if (item.type === 'transit') {
        if (isFillableTransitRow(item)) {
          // 就地补齐目标；同时视为"两坐标条目之间已有交通行"，绝不在旁边
          // 插第二行（N1）——补不上的留给交通门当缺口上报
          pendingFill.push(item)
        } else {
          sawQualifiedTransit = true
        }
        index += 1
        continue
      }
      const coords = coordsOfItem(item, ctx)
      if (!coords) {
        index += 1
        continue
      }
      if (lastLabeled && (pendingFill.length > 0 || !sawQualifiedTransit)) {
        const target = pendingFill[0] ?? null
        const outcome = await resolveSegmentPayload(ctx, lastLabeled.coords, coords)
        if ('skip' in outcome) {
          report.skipped.push({
            enricher: 'transport',
            itemTitle: `${lastLabeled.title} → ${item.title}`,
            reason: outcome.skip,
          })
        } else if (target) {
          // A4：就地写入现有 transit 行（不新插行、不重复）；保留兄弟字段
          target.payload = { ...(target.payload ?? {}), transport: outcome.payload }
          report.applied.transport += 1
        } else {
          day.items.splice(index, 0, {
            type: 'transit',
            title: `${lastLabeled.title} → ${item.title}`,
            payload: { transport: outcome.payload },
          })
          report.applied.transport += 1
          // 插入行落在 index、当前条目移到 index+1：链头换成当前条目，
          // 游标跳过两行，避免把当前条目再当"下一个缺口"重复补
          lastLabeled = { title: item.title, coords }
          sawQualifiedTransit = false
          pendingFill = []
          index += 2
          continue
        }
      }
      lastLabeled = { title: item.title, coords }
      sawQualifiedTransit = false
      pendingFill = []
      index += 1
    }
  }
}
