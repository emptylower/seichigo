import type { AnitabiDiffItem } from './types'

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return new Date(ms).toLocaleString('zh-CN')
}

export function formatWindow(start: string, end: string): string {
  return `${formatDateTime(start)} → ${formatDateTime(end)}`
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-'
  return `${(value * 100).toFixed(1)}%`
}

export function statusColor(status: string): string {
  if (status === 'ok') return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (status === 'partial') return 'text-amber-700 bg-amber-50 border-amber-200'
  if (status === 'failed') return 'text-rose-700 bg-rose-50 border-rose-200'
  return 'text-gray-700 bg-gray-50 border-gray-200'
}

export function severityColor(severity: string): string {
  if (severity === 'severe') return 'text-rose-700 bg-rose-50 border-rose-200'
  return 'text-amber-700 bg-amber-50 border-amber-200'
}

export function formatAnitabiDiffItem(item: AnitabiDiffItem): string {
  const points =
    item.expectedPoints != null && item.importedPoints != null
      ? `点位 ${item.importedPoints}/${item.expectedPoints}`
      : '点位 -'
  return `#${item.id} ${item.title} · ${points}`
}
