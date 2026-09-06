/** 加 n 个月，日数超出目标月天数时钳到该月最后一天（1/31 + 1 月 = 2/28） */
export function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d
}

/**
 * 以 anchor（订阅日/注册日）为锚按月滚动，返回包含 now 的周期
 * [periodStart, periodEnd)。now 早于 anchor 时返回第一个周期。
 *
 * G11：n 用月差直接算（(now.year − anchor.year) × 12 + (now.month − anchor.month)），
 * 再前后各校正一次，避免逐月 while 循环在长周期上空转。
 */
export function computePeriod(anchor: Date, now: Date): { periodStart: Date; periodEnd: Date } {
  const diff = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth())
  let n = Math.max(0, diff)
  let start = addMonthsClamped(anchor, n)
  // 后校正：算出的起点已晚于 now（如 1/31 锚点在 3 月初）→ 退一个月；不低于第一个周期
  if (start.getTime() > now.getTime()) {
    n = Math.max(0, n - 1)
    start = addMonthsClamped(anchor, n)
  }
  let end = addMonthsClamped(anchor, n + 1)
  // 前校正：now 已越过终点（钳制导致月差偏小）→ 进一个月
  if (now.getTime() >= end.getTime()) {
    n += 1
    start = end
    end = addMonthsClamped(anchor, n + 1)
  }
  return { periodStart: start, periodEnd: end }
}
