/**
 * 行程质量门控（M4 §5，纯函数）：save_plan_days 落库前与阶段推断共用。
 * 硬失败只保留模型自己能改的错误（point/attraction 坐标、schedule、出处）；
 * 外部服务缺口（交通、meal/lodging 坐标、density/media/estimate_ratio/时长
 * 跨度）一律 soft，允许落库、进报告供质量卡与提示词展示，留给下一回合的
 * enricher 补齐。只读输入，绝不改写 days/coords。
 */

export type GateId = 'coords' | 'transport' | 'schedule' | 'provenance' | 'density' | 'media' | 'estimate_ratio'

export type GateFailure = {
  gate: GateId
  severity: 'hard' | 'soft'
  dayIndex: number
  itemTitle?: string
  fix: string
}

export type PlanQualityStats = {
  visitItems: number
  withCoords: number
  withMedia: number
  transitLegs: number
  transitReal: number
  transitEstimated: number
  missingTransit: number
  daySpanMaxMin: number
}

export type PlanQualityReport = {
  /** 无 hard 失败时为 true（软失败不影响落库） */
  passed: boolean
  hard: GateFailure[]
  soft: GateFailure[]
  stats: PlanQualityStats
  evaluatedAt: string
}

export type GateDayInput = {
  dayIndex: number
  items: Array<{ type: string; title: string; pointId?: string | null; payload?: Record<string, unknown> | null }>
}

/** 站内点位坐标（含图片，供图片门判定）；image 缺省视为无图 */
export type GatePointCoord = { lat: number; lng: number; image?: string | null }

export const GATE_MAX_DAY_SPAN_MIN = 13 * 60
export const GATE_MEDIA_RATIO_MIN = 0.8
export const GATE_ESTIMATE_RATIO_MAX = 0.6
export const GATE_DENSITY_MIN = 3
export const GATE_DENSITY_MAX = 9

/** 可到访条目：需要坐标/图片/参与交通相邻判定的类型（free 与 transit 不算） */
const VISIT_ITEM_TYPES = new Set(['point', 'attraction', 'lodging', 'meal'])

function isVisitItem(item: GateDayInput['items'][number]): boolean {
  return VISIT_ITEM_TYPES.has(item.type)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** 外部地点坐标：payload.place.lat/lng */
function placeCoordsOf(item: GateDayInput['items'][number]): { lat: number; lng: number } | null {
  const place = asRecord(item.payload?.place)
  if (!place) return null
  const lat = Number(place.lat)
  const lng = Number(place.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

/** 条目坐标：pointId 命中优先，其次 payload.place */
function coordsOf(item: GateDayInput['items'][number], coordsByPointId: Map<string, GatePointCoord>): { lat: number; lng: number } | null {
  if (item.pointId) {
    const hit = coordsByPointId.get(item.pointId)
    if (hit) return { lat: hit.lat, lng: hit.lng }
  }
  return placeCoordsOf(item)
}

function transportRecordOf(item: GateDayInput['items'][number]): Record<string, unknown> | null {
  return asRecord(item.payload?.transport)
}

/**
 * M1 扁平交通载荷：transit 行的 mode/durationMin 直接在 payload 根上（无
 * payload.transport）。视为已有交通（provider 记 'legacy'），gate 计入
 * transitLegs，enricher 也不再在旁边插第二行。
 */
function isLegacyFlatTransit(item: GateDayInput['items'][number]): boolean {
  if (transportRecordOf(item)) return false
  const payload = item.payload ?? {}
  const mode = typeof payload.mode === 'string' ? payload.mode.trim() : ''
  const durationMin = Number(payload.durationMin)
  return mode.length > 0 || (Number.isFinite(durationMin) && durationMin > 0)
}

function clockToMinutes(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

/** payload.schedule 的起止分钟（end 缺失/非法时以 start 兜底）；无合法 start 返回 null */
function scheduleWindowOf(payload: Record<string, unknown>): { startMin: number; endMin: number } | null {
  const schedule = asRecord(payload.schedule)
  if (!schedule) return null
  const start = clockToMinutes(schedule.start)
  if (start === null) return null
  const end = clockToMinutes(schedule.end)
  return { startMin: start, endMin: end === null ? start : Math.max(start, end) }
}

function hasUsableMedia(item: GateDayInput['items'][number], coordsByPointId: Map<string, GatePointCoord>): boolean {
  const media = asRecord(item.payload?.media)
  if (typeof media?.displayUrl === 'string' && media.displayUrl) return true
  if (item.pointId) {
    const coord = coordsByPointId.get(item.pointId)
    if (typeof coord?.image === 'string' && coord.image) return true
  }
  return false
}

export function evaluatePlanGates(
  days: GateDayInput[],
  coordsByPointId: Map<string, GatePointCoord>,
  scheduleOk: boolean,
): PlanQualityReport {
  const hard: GateFailure[] = []
  const soft: GateFailure[] = []
  const stats: PlanQualityStats = {
    visitItems: 0,
    withCoords: 0,
    withMedia: 0,
    transitLegs: 0,
    transitReal: 0,
    transitEstimated: 0,
    missingTransit: 0,
    daySpanMaxMin: 0,
  }

  if (!scheduleOk) {
    hard.push({
      gate: 'schedule',
      severity: 'hard',
      dayIndex: 0,
      fix: '时间归一化未通过（存在非法时间或无法自愈的显式时间冲突），请修正各条目时间后重新保存',
    })
  }

  for (const day of days) {
    let dayVisitCount = 0
    let dayFirstStart: number | null = null
    let dayLastEnd: number | null = null
    let lastLabeled: { title: string } | null = null
    let sawQualifiedTransit = false

    for (const item of day.items) {
      const payload = item.payload ?? {}

      const window = scheduleWindowOf(payload)
      // 跨度统计排除 lodging：酒店入住常被排在一天末尾（21:00+），把它算进
      // 首末跨度会误伤正常的晚间安排
      if (window && item.type !== 'lodging') {
        dayFirstStart = dayFirstStart === null ? window.startMin : Math.min(dayFirstStart, window.startMin)
        dayLastEnd = dayLastEnd === null ? window.endMin : Math.max(dayLastEnd, window.endMin)
      }

      // 出处门只检查 payload.place 存在的条目；transit 行与带 pointId 的
      // point 条目不检查 place（历史数据可能残留，交由保存前的专校验处置）
      const place = asRecord(payload.place)
      const placeProvenanceInScope =
        Boolean(place) && item.type !== 'transit' && !(item.type === 'point' && item.pointId)
      if (place && placeProvenanceInScope) {
        const missingFields: string[] = []
        if (!String(place.provider ?? '').trim()) missingFields.push('provider')
        if (!String(place.placeId ?? '').trim()) missingFields.push('placeId')
        if (missingFields.length) {
          hard.push({
            gate: 'provenance',
            severity: 'hard',
            dayIndex: day.dayIndex,
            itemTitle: item.title,
            fix: `条目「${item.title}」的 payload.place 缺少 ${missingFields.join('/')}——必须原样照抄 resolve_place 返回的 place，不要手写或编造`,
          })
        }
      }

      if (item.type === 'transit') {
        const transport = transportRecordOf(item)
        const provider = transport ? String(transport.provider ?? '') : ''
        if (transport && provider) {
          stats.transitLegs += 1
          const estimated = transport.estimated === true
          if (estimated || provider === 'estimate') stats.transitEstimated += 1
          else stats.transitReal += 1
          if (estimated && provider !== 'estimate') {
            hard.push({
              gate: 'provenance',
              severity: 'hard',
              dayIndex: day.dayIndex,
              itemTitle: item.title,
              fix: `交通段「${item.title}」标记为估算（estimated:true）但 provider 不是「estimate」——请原样照抄 estimate_travel 返回的 transportPayload`,
            })
          }
          sawQualifiedTransit = true
        } else if (isLegacyFlatTransit(item)) {
          // M1 扁平载荷（provider 记 'legacy'）：计入 transitLegs，不再当缺口
          stats.transitLegs += 1
          stats.transitReal += 1
          sawQualifiedTransit = true
        }
        // N6：payload.transport 存在但 provider 为空的行不计入 transitLegs
        //（估算占比的分母不失真），也不算合格交通——缺口照常计入
        // missingTransit（soft，由 transport enricher 下一回合补齐）
      }

      if (!isVisitItem(item)) continue
      dayVisitCount += 1
      stats.visitItems += 1

      const coords = coordsOf(item, coordsByPointId)
      if (coords) {
        stats.withCoords += 1
      } else {
        // N2：meal/lodging 的坐标缺口多半是外部服务不可用/限流所致——soft，
        // 允许落库、下一回合由 place/restaurant enricher 继续补齐；point（含
        // pointId 或 payload.place）与 attraction 无坐标是模型自己能改的
        // 错误，仍为 hard
        const hardCoords = item.type === 'point' || item.type === 'attraction'
        const failure: GateFailure = {
          gate: 'coords',
          severity: hardCoords ? 'hard' : 'soft',
          dayIndex: day.dayIndex,
          itemTitle: item.title,
          fix: hardCoords
            ? `条目「${item.title}」缺少坐标：站内点位必须带 pointId，外部地点先用 resolve_place 解析并把 place 原样放进 payload.place`
            : `条目「${item.title}」地点未能解析（外部服务不可用或限流），下一回合继续补齐`,
        }
        ;(hardCoords ? hard : soft).push(failure)
      }

      if (hasUsableMedia(item, coordsByPointId)) stats.withMedia += 1

      if (coords) {
        if (lastLabeled && !sawQualifiedTransit) {
          // 交通门是 soft：外部服务缺失/限流不该卡保存，缺口交给下一回合
          // 的 transport enricher 自动补齐（阶段推断会再次进入 enrich）
          stats.missingTransit += 1
          soft.push({
            gate: 'transport',
            severity: 'soft',
            dayIndex: day.dayIndex,
            itemTitle: `${lastLabeled.title} → ${item.title}`,
            fix: `「${lastLabeled.title}」→「${item.title}」之间缺少交通段，不影响保存：服务端会在下次保存时自动补齐，也可用 estimate_travel 查真实路线后写入`,
          })
        }
        lastLabeled = { title: item.title }
        sawQualifiedTransit = false
      }
    }

    if (dayVisitCount < GATE_DENSITY_MIN || dayVisitCount > GATE_DENSITY_MAX) {
      soft.push({
        gate: 'density',
        severity: 'soft',
        dayIndex: day.dayIndex,
        fix: `Day ${day.dayIndex} 可到访条目 ${dayVisitCount} 个（建议 ${GATE_DENSITY_MIN}–${GATE_DENSITY_MAX} 个），${dayVisitCount < GATE_DENSITY_MIN ? '当天安排偏少' : '当天安排过密'}`,
      })
    }

    if (dayFirstStart !== null && dayLastEnd !== null) {
      const spanMin = dayLastEnd - dayFirstStart
      stats.daySpanMaxMin = Math.max(stats.daySpanMaxMin, spanMin)
      if (spanMin > GATE_MAX_DAY_SPAN_MIN) {
        // 跨度门是 soft：只提示偏满，不拒绝落库
        soft.push({
          gate: 'schedule',
          severity: 'soft',
          dayIndex: day.dayIndex,
          fix: `Day ${day.dayIndex} 首末时间跨度超过 13 小时（${Math.floor(spanMin / 60)} 小时 ${spanMin % 60} 分），当天安排偏满，建议精简（不影响保存）`,
        })
      }
    }
  }

  if (stats.visitItems > 0 && stats.withMedia / stats.visitItems < GATE_MEDIA_RATIO_MIN) {
    soft.push({
      gate: 'media',
      severity: 'soft',
      dayIndex: 0,
      fix: `有图条目 ${stats.withMedia}/${stats.visitItems}（低于 80%）：外部地点照抄 resolve_place 的 media，站内点位自带巡礼照片`,
    })
  }

  if (stats.transitLegs > 0 && stats.transitEstimated / stats.transitLegs > GATE_ESTIMATE_RATIO_MAX) {
    soft.push({
      gate: 'estimate_ratio',
      severity: 'soft',
      dayIndex: 0,
      fix: `估算交通占比过高（${stats.transitEstimated}/${stats.transitLegs} 段），优先用 estimate_travel 获取真实路线`,
    })
  }

  return { passed: hard.length === 0, hard, soft, stats, evaluatedAt: new Date().toISOString() }
}
