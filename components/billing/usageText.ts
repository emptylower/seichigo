/** 用户可见文案（设计 §4）：百分比向下取整；0 < x < 1 显示 "<1%" */
export function formatPercent(percent: number): string {
  if (percent <= 0) return '0%'
  if (percent < 1) return '<1%'
  return `${Math.floor(percent)}%`
}

/** "9 月 20 日恢复"；无效日期返回空串 */
export function formatResetDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日恢复`
}

export type UsageTone = 'ok' | 'low' | 'empty'

export function usageBarTone(percent: number): UsageTone {
  if (percent <= 0) return 'empty'
  if (percent <= 25) return 'low'
  return 'ok'
}
