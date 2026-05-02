export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return new Date(ms).toLocaleString('zh-CN')
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function boolLabel(value: boolean): string {
  return value ? '采样' : '未采样'
}

export function statusColor(status: string): string {
  if (status === 'failed') return 'text-rose-700 bg-rose-50 border-rose-200'
  if (status === 'aborted' || status === 'superseded') return 'text-amber-700 bg-amber-50 border-amber-200'
  if (status === 'succeeded') return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  return 'text-gray-700 bg-gray-50 border-gray-200'
}

export function truncateMiddle(value: string | null | undefined, head = 20, tail = 18): string {
  const text = String(value || '').trim()
  if (!text) return '-'
  if (text.length <= head + tail + 3) return text
  return `${text.slice(0, head)}...${text.slice(-tail)}`
}

export function formatDuration(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-'
  return `${Math.round(value)}ms`
}

export function formatPercent(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return '0%'
  return `${Math.round((value / total) * 100)}%`
}

export function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}
