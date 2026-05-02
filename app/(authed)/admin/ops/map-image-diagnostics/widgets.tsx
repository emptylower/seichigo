export function MetricCard({
  label,
  value,
  helper,
}: {
  label: string
  value: string
  helper?: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
      {helper ? <div className="mt-1 text-xs text-gray-500">{helper}</div> : null}
    </div>
  )
}

export function HorizontalBarList({
  rows,
  total,
  colorClass,
  formatRight,
}: {
  rows: Array<{ label: string; count: number }>
  total: number
  colorClass: string
  formatRight?: (count: number) => string
}) {
  if (!rows.length) {
    return <div className="text-sm text-gray-500">当前时间范围内暂无数据。</div>
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const width = total > 0 ? Math.max(6, Math.round((row.count / total) * 100)) : 0
        return (
          <div key={row.label} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-gray-700">{row.label}</span>
              <span className="shrink-0 text-gray-500">{formatRight ? formatRight(row.count) : row.count}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function TimelineBars({
  rows,
}: {
  rows: Array<{ label: string; total: number; degraded: number }>
}) {
  if (!rows.length) {
    return <div className="text-sm text-gray-500">当前时间范围内暂无趋势数据。</div>
  }

  const max = rows.reduce((value, row) => Math.max(value, row.total), 0)

  return (
    <div className="flex items-end gap-2">
      {rows.map((row) => {
        const totalHeight = max > 0 ? Math.max(8, Math.round((row.total / max) * 120)) : 0
        const degradedHeight = row.total > 0 ? Math.max(0, Math.round((row.degraded / row.total) * totalHeight)) : 0
        return (
          <div key={row.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex h-32 w-full items-end justify-center rounded-md bg-gray-50 px-1">
              <div className="relative w-full max-w-8 rounded-sm bg-emerald-200" style={{ height: `${totalHeight}px` }}>
                {degradedHeight > 0 ? (
                  <div className="absolute inset-x-0 bottom-0 rounded-sm bg-rose-400" style={{ height: `${degradedHeight}px` }} />
                ) : null}
              </div>
            </div>
            <div className="text-[11px] text-gray-500">{row.label}</div>
          </div>
        )
      })}
    </div>
  )
}
