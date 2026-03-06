'use client'

import type { WindowExcerptBangumiItem, WindowExcerptPointItem } from '@/features/map/anitabi/windowExcerpt'

type Props = {
  bangumis: WindowExcerptBangumiItem[]
  points: WindowExcerptPointItem[]
  activeBangumiId: number | null
  activePointId: string | null
  onBangumiClick: (bangumiId: number) => void
  onPointClick: (bangumiId: number, pointId: string) => void
}

function timeLabel(value: string | null): string | null {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) {
    const totalSeconds = Number.parseInt(raw, 10)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }
  return raw
}

export function WindowExcerptOverlay({
  bangumis,
  points,
  activeBangumiId,
  activePointId,
  onBangumiClick,
  onPointClick,
}: Props) {
  if (!bangumis.length && !points.length) return null

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-30 flex max-w-[360px] flex-col gap-3">
      {bangumis.length ? (
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {bangumis.map((item) => {
            const active = item.bangumiId === activeBangumiId
            return (
              <button
                key={item.bangumiId}
                type="button"
                onClick={() => onBangumiClick(item.bangumiId)}
                className={`relative h-12 w-12 overflow-hidden rounded-full border-2 bg-white shadow-lg transition ${
                  active ? 'border-brand-500 scale-105' : 'border-white/90 hover:scale-105'
                }`}
                title={item.title}
                style={{ boxShadow: active ? `0 0 0 2px ${item.color}66` : undefined }}
              >
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-xs font-semibold text-slate-600">
                    {item.title.slice(0, 1)}
                  </div>
                )}
                <span
                  className="absolute -bottom-0.5 -right-0.5 min-w-[20px] rounded-full border border-white px-1 text-[10px] font-semibold leading-5 text-white"
                  style={{ background: item.color }}
                >
                  {item.count}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      {points.length ? (
        <div className="pointer-events-auto grid grid-cols-3 gap-2 rounded-2xl border border-white/60 bg-white/85 p-2 shadow-2xl backdrop-blur">
          {points.map((item) => {
            const active = item.pointId === activePointId
            return (
              <button
                key={item.pointId}
                type="button"
                onClick={() => onPointClick(item.bangumiId, item.pointId)}
                className={`group relative overflow-hidden rounded-xl border text-left shadow-sm transition ${
                  active ? 'border-brand-500 ring-2 ring-brand-300' : 'border-slate-200 hover:border-brand-300'
                }`}
                style={{ backgroundColor: `${item.bangumiColor}10` }}
                title={item.pointName}
              >
                <img
                  src={item.imageUrl}
                  alt={item.pointName}
                  className="h-20 w-full object-cover transition group-hover:scale-[1.03]"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4 text-white">
                  <div className="line-clamp-1 text-[11px] font-medium">{item.pointName}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-white/80">
                    {item.ep ? <span>{item.ep}</span> : null}
                    {timeLabel(item.s) ? <span>{timeLabel(item.s)}</span> : null}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
