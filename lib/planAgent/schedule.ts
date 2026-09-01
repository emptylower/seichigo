/**
 * 行程时间归一化器（M3，确定性后端算法）：模型可以给粗略顺序，但落库与渲染
 * 前的最终时间轴必须由这里统一生成。
 *
 * 规则（docs/superpowers/plans/2026-09-01-plan-agent-m3-interaction-upgrade.md §6）：
 * - 每个条目解析成有效的本地时间区间：显式 HH:mm 优先；缺失时间从日起点、
 *   游览时长与点间交通推导；"午后/傍晚"等宽泛标签换算成参考时刻，原标签保留。
 * - transit 行与相邻点位进入同一时间序列；全部条目按本地开始时间排序并重建
 *   sortOrder；前端也按结构化时间防御性排序，不信任插入顺序。
 * - 非法时间、显式时间冲突、缺坐标的可路由条目、缺 payload.place 的外部点位
 *   → 显式错误，绝不静默丢点。
 */

export type ScheduleConfidence = 'explicit' | 'reference' | 'estimated'

export type ScheduleWindow = {
  start: string // 'HH:mm'
  end: string // 'HH:mm'
  confidence: ScheduleConfidence
}

export type ScheduleItemInput = {
  type: string
  title: string
  pointId?: string | null
  timeHint?: string | null
  note?: string | null
  reason?: string | null
  payload?: Record<string, unknown> | null
}

export type ScheduleItemOutput = ScheduleItemInput & {
  payload: Record<string, unknown>
  sortOrder: number
  resolvedStartMin: number
}

export type NormalizeDayScheduleResult =
  | { ok: true; items: ScheduleItemOutput[] }
  | { ok: false; errors: string[] }

/** 一天默认从 09:00 开始；单个点位默认游览 60 分钟 */
export const DAY_START_MIN = 9 * 60
export const DEFAULT_VISIT_MIN = 60
export const DEFAULT_TRANSIT_MIN = 20

/** 目的地时区偏移（分钟）。圣地巡礼场景以日本为主，默认 Asia/Tokyo +540 */
export const SCHEDULE_TZ_OFFSET_MIN = 9 * 60

const VAGUE_LABEL_MINUTES: Array<{ pattern: RegExp; minutes: number }> = [
  { pattern: /清晨|拂晓/, minutes: 6 * 60 },
  { pattern: /早上|早晨|一早/, minutes: 8 * 60 },
  { pattern: /上午/, minutes: 9 * 60 },
  { pattern: /中午|正午/, minutes: 12 * 60 },
  { pattern: /午后/, minutes: 13 * 60 },
  { pattern: /下午/, minutes: 14 * 60 },
  { pattern: /傍晚|黄昏|夕方/, minutes: 17 * 60 },
  { pattern: /晚上|今晚|夜里/, minutes: 19 * 60 },
  { pattern: /深夜|半夜/, minutes: 21 * 60 },
]

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function minutesToClock(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)))
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`
}

function parseClockToMinutes(raw: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

/** 从自由文本里解析显式时刻/区间：先 payload.schedule，再 timeHint（"14:00"、"14:00-15:30"） */
function parseExplicitWindow(item: ScheduleItemInput): { start: number; end: number | null } | null {
  const payload = item.payload ?? {}
  const schedule = payload.schedule
  const scheduleRecord = typeof schedule === 'object' && schedule !== null && !Array.isArray(schedule)
    ? (schedule as Record<string, unknown>)
    : {}

  const fromSchedule: { start: number; end: number | null } | null = (() => {
    const startRaw = typeof scheduleRecord.start === 'string' ? scheduleRecord.start : ''
    const endRaw = typeof scheduleRecord.end === 'string' ? scheduleRecord.end : ''
    const start = parseClockToMinutes(startRaw)
    const end = parseClockToMinutes(endRaw)
    if (start === null) return null
    return { start, end: end === null ? null : end }
  })()
  if (fromSchedule) return fromSchedule

  const hint = String(item.timeHint ?? '')
  const range = /(\d{1,2}:\d{2})\s*[-–~～至到]{1,2}\s*(\d{1,2}:\d{2})/.exec(hint)
  if (range) {
    const start = parseClockToMinutes(range[1])
    const end = parseClockToMinutes(range[2])
    if (start !== null && end !== null) return { start, end }
  }
  const single = /(\d{1,2}:\d{2})/.exec(hint)
  if (single) {
    const start = parseClockToMinutes(single[1])
    if (start !== null) return { start, end: null }
  }
  return null
}

/** 宽泛标签 → 参考时刻（找不到返回 null） */
function vagueLabelToMinutes(item: ScheduleItemInput): number | null {
  const hint = String(item.timeHint ?? '')
  if (!hint) return null
  for (const { pattern, minutes } of VAGUE_LABEL_MINUTES) {
    if (pattern.test(hint)) return minutes
  }
  return null
}

function visitDurationMin(item: ScheduleItemInput): number {
  const payload = item.payload ?? {}
  const schedule = typeof payload.schedule === 'object' && payload.schedule !== null && !Array.isArray(payload.schedule)
    ? (payload.schedule as Record<string, unknown>)
    : {}
  const raw = Number(schedule.durationMin)
  if (Number.isFinite(raw) && raw > 0) return Math.min(12 * 60, Math.round(raw))
  return DEFAULT_VISIT_MIN
}

function transitDurationMin(item: ScheduleItemInput): number {
  const payload = item.payload ?? {}
  // estimate_travel 结果在 payload.transport；旧数据在 payload 根字段
  const transport = typeof payload.transport === 'object' && payload.transport !== null && !Array.isArray(payload.transport)
    ? (payload.transport as Record<string, unknown>)
    : {}
  for (const holder of [transport, payload]) {
    const raw = Number(holder.durationMin)
    if (Number.isFinite(raw) && raw > 0) return Math.min(12 * 60, Math.round(raw))
  }
  return DEFAULT_TRANSIT_MIN
}

function isTransit(item: ScheduleItemInput): boolean {
  return item.type === 'transit'
}

type ResolvedItem = {
  input: ScheduleItemInput
  index: number
  startMin: number
  endMin: number
  confidence: ScheduleConfidence
  explicit: boolean
}

/**
 * 归一化单天行程。输入按模型给出的插入顺序，输出按解析后的本地开始时间
 * 排序，并为每个条目写入 payload.schedule = { start, end, confidence }。
 */
export function normalizeDaySchedule(items: ScheduleItemInput[]): NormalizeDayScheduleResult {
  const errors: string[] = []
  const resolved: ResolvedItem[] = []
  let cursor = DAY_START_MIN

  items.forEach((item, index) => {
    const label = item.title || `条目 ${index + 1}`

    if (isTransit(item)) {
      const duration = transitDurationMin(item)
      const explicit = parseExplicitWindow(item)
      const start = explicit ? explicit.start : cursor
      const end = start + duration
      if (end <= start) errors.push(`「${label}」交通时长不合法`)
      resolved.push({ input: item, index, startMin: start, endMin: end, confidence: explicit ? 'explicit' : 'estimated', explicit: Boolean(explicit) })
      cursor = end
      return
    }

    const explicit = parseExplicitWindow(item)
    const duration = visitDurationMin(item)
    if (explicit) {
      if (explicit.end !== null && explicit.end <= explicit.start) {
        errors.push(`「${label}」的显式时间区间不合法（结束早于开始）`)
      }
      const end = explicit.end !== null && explicit.end > explicit.start ? explicit.end : explicit.start + duration
      resolved.push({ input: item, index, startMin: explicit.start, endMin: end, confidence: 'explicit', explicit: true })
      cursor = Math.max(cursor, end)
      return
    }

    const vague = vagueLabelToMinutes(item)
    if (vague !== null) {
      // 参考时刻不能早于当前游标（时间只前进）；被顶后降级为 estimated
      const start = Math.max(cursor, vague)
      resolved.push({
        input: item,
        index,
        startMin: start,
        endMin: start + duration,
        confidence: start === vague ? 'reference' : 'estimated',
        explicit: false,
      })
      cursor = start + duration
      return
    }

    resolved.push({ input: item, index, startMin: cursor, endMin: cursor + duration, confidence: 'estimated', explicit: false })
    cursor += duration
  })

  // 不可能重叠检测（M3 brief：检查**所有**最终解析出的区间，不只是 explicit-vs-explicit）：
  // 推导/宽泛换算出的区间与显式区间重叠同样必须报错，不能静默落库。
  // 扫描线：按解析后开始时间排序，与"最大结束区间"做**严格**区间重叠比对
  // （cur.start < widest.end 即重叠，一分钟也算）；相邻衔接（start == end）通过。
  const byStart = [...resolved].sort((a, b) => a.startMin - b.startMin || a.index - b.index)
  let widest = byStart[0]
  for (let i = 1; i < byStart.length; i++) {
    const cur = byStart[i]
    if (widest && cur.startMin < widest.endMin) {
      errors.push(
        `「${widest.input.title}」（${minutesToClock(widest.startMin)}–${minutesToClock(widest.endMin)}）与` +
          `「${cur.input.title}」（${minutesToClock(cur.startMin)}–${minutesToClock(cur.endMin)}）的最终时间区间重叠，请调整时间或顺序`,
      )
    }
    if (!widest || cur.endMin > widest.endMin) widest = cur
  }

  if (errors.length) return { ok: false, errors }

  const sorted = [...resolved].sort((a, b) => a.startMin - b.startMin || a.index - b.index)
  const out: ScheduleItemOutput[] = sorted.map((r, sortOrder) => {
    const payload: Record<string, unknown> = { ...(r.input.payload ?? {}) }
    payload.schedule = {
      start: minutesToClock(r.startMin),
      end: minutesToClock(r.endMin),
      confidence: r.confidence,
    } satisfies ScheduleWindow
    return {
      ...r.input,
      payload,
      sortOrder,
      resolvedStartMin: r.startMin,
    }
  })
  return { ok: true, items: out }
}

/**
 * 精确日期 → Google departure_time（epoch 秒）。startDate 是当日 0 点（本地
 * 存库值），dayIndex 从 1 起，minutesFromMidnight 是当地时钟分钟数；按目的地
 * 时区偏移换算 UTC。startDate 为 null（模糊日期）返回 null。
 */
export function computeDepartureEpochSec(
  startDate: Date | null,
  dayIndex: number,
  minutesFromMidnight: number,
  tzOffsetMin = SCHEDULE_TZ_OFFSET_MIN,
): number | null {
  if (!startDate || Number.isNaN(startDate.getTime())) return null
  const day = Math.max(1, Math.floor(dayIndex))
  const minutes = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutesFromMidnight)))
  // startDate 的 UTC 0 点视为目的地当地 0 点（存库约定），加上偏移得到 UTC 时刻
  const baseUtc = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
  return Math.floor((baseUtc + (day - 1) * 24 * 60 * 60 * 1000 + minutes * 60 * 1000 - tzOffsetMin * 60 * 1000) / 1000)
}
