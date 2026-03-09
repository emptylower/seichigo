'use client'

import type { WindowExcerptBangumiItem, WindowExcerptPointItem } from '@/features/map/anitabi/windowExcerpt'

type BangumiRowProps = {
  bangumis: WindowExcerptBangumiItem[]
  activeBangumiId: number | null
  onBangumiClick: (bangumiId: number) => void
}

type PointStripProps = {
  points: WindowExcerptPointItem[]
  activePointId: string | null
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

function distanceLabel(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters)) return ''
  if (distanceMeters >= 1000) {
    const km = distanceMeters / 1000
    return km >= 10 ? `${Math.round(km)}km` : `${km.toFixed(1)}km`
  }
  return `${Math.max(1, Math.round(distanceMeters))}m`
}

export function MobileVisualCenterBangumiRow({
  bangumis,
  activeBangumiId,
  onBangumiClick,
}: BangumiRowProps) {
  if (!bangumis.length) return null

  return (
    <div className="pointer-events-auto min-w-0 flex-1 overflow-x-auto">
      <div className="flex w-max min-w-full items-center justify-start gap-2 px-1">
        {bangumis.map((item) => {
          const active = item.bangumiId === activeBangumiId
          return (
            <button
              key={item.bangumiId}
              type="button"
              onClick={() => onBangumiClick(item.bangumiId)}
              className={`relative h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 bg-white shadow-lg transition ${
                active ? 'border-brand-500 scale-105' : 'border-white/90'
              }`}
              title={item.title}
              style={{ boxShadow: active ? `0 0 0 2px ${item.color}55` : undefined }}
            >
              {item.coverUrl ? (
                <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="grid h-full w-full place-items-center text-xs font-semibold text-slate-600">
                  {item.title.slice(0, 1)}
                </div>
              )}
              <span
                className="absolute -bottom-0.5 -right-0.5 min-w-[18px] rounded-full border border-white px-1 text-[9px] font-semibold leading-4 text-white"
                style={{ background: item.color }}
              >
                {item.count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function MobileVisualCenterPointStrip({
  points,
  activePointId,
  onPointClick,
}: PointStripProps) {
  if (!points.length) return null

  return (
    <div
      className="pointer-events-none absolute inset-x-3 z-20"
      style={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
    >
      <div className="pointer-events-auto -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {points.map((item) => {
          const active = item.pointId === activePointId
          return (
            <button
              key={item.pointId}
              type="button"
              onClick={() => onPointClick(item.bangumiId, item.pointId)}
              className={`group relative w-[152px] shrink-0 overflow-hidden rounded-[20px] border bg-white/92 text-left shadow-[0_14px_36px_rgba(15,23,42,0.18)] backdrop-blur-md transition ${
                active ? 'border-brand-500 ring-2 ring-brand-300' : 'border-white/80'
              }`}
              title={item.pointName}
            >
              <img
                src={item.imageUrl}
                alt={item.pointName}
                className="h-24 w-full object-cover transition group-hover:scale-[1.03]"
                loading="lazy"
              />
              <div className="absolute left-2.5 top-2.5 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
                {item.bangumiTitle}
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/82 to-transparent px-2.5 pb-2 pt-7 text-white">
                <div className="line-clamp-2 text-[11px] font-medium">{item.pointName}</div>
                <div className="mt-1 flex items-end justify-between gap-2 text-[10px] text-white/80">
                  <div className="flex min-w-0 items-center gap-1">
                    {item.ep ? <span className="shrink-0">{item.ep}</span> : null}
                    {timeLabel(item.s) ? <span className="shrink-0">{timeLabel(item.s)}</span> : null}
                  </div>
                  <span className="shrink-0 rounded-full bg-black/45 px-1.5 py-0.5 font-medium text-white/90 backdrop-blur-sm">
                    {distanceLabel(item.distanceMeters)}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
