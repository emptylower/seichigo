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
 */
export function computePeriod(anchor: Date, now: Date): { periodStart: Date; periodEnd: Date } {
  let start = new Date(anchor.getTime())
  let end = addMonthsClamped(anchor, 1)
  let n = 1
  while (now.getTime() >= end.getTime()) {
    start = end
    n += 1
    end = addMonthsClamped(anchor, n)
  }
  return { periodStart: start, periodEnd: end }
}
