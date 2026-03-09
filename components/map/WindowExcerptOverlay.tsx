'use client'

import type { WindowExcerptBangumiItem, WindowExcerptPointItem } from '@/features/map/anitabi/windowExcerpt'

type Props = {
  bangumis: WindowExcerptBangumiItem[]
  points: WindowExcerptPointItem[]
  activeBangumiId: number | null
  activePointId: string | null
  onBangumiClick: (bangumiId: number) => void
  onPointClick: (bangumiId: number, pointId: string) => void
  layout?: 'desktop' | 'mobile'
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

function BangumiAvatar({
  item,
  active,
  onClick,
  compact,
}: {
  item: WindowExcerptBangumiItem
  active: boolean
  onClick: () => void
  compact: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden rounded-full border-2 bg-white shadow-lg transition ${
        compact ? 'h-11 w-11 shrink-0' : 'h-12 w-12'
      } ${
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
        className={`absolute min-w-[20px] rounded-full border border-white px-1 text-[10px] font-semibold leading-5 text-white ${
          compact ? '-bottom-0.5 -right-0.5' : '-bottom-0.5 -right-0.5'
        }`}
        style={{ background: item.color }}
      >
        {item.count}
      </span>
    </button>
  )
}

function PointCard({
  item,
  active,
  onClick,
  compact,
}: {
  item: WindowExcerptPointItem
  active: boolean
  onClick: () => void
  compact: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden border text-left shadow-sm transition ${
        compact
          ? 'w-[158px] shrink-0 rounded-[20px] bg-white/88 backdrop-blur-md'
          : 'rounded-xl'
      } ${
        active ? 'border-brand-500 ring-2 ring-brand-300' : 'border-slate-200 hover:border-brand-300'
      }`}
      style={{ backgroundColor: compact ? undefined : `${item.bangumiColor}10` }}
      title={item.pointName}
    >
      <img
        src={item.imageUrl}
        alt={item.pointName}
        className={`${compact ? 'h-24' : 'h-20'} w-full object-cover transition group-hover:scale-[1.03]`}
        loading="lazy"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/82 to-transparent px-2.5 pb-2 pt-6 text-white">
        <div className={`${compact ? 'line-clamp-2 text-[11px]' : 'line-clamp-1 text-[11px]'} font-medium`}>
          {item.pointName}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-white/80">
          {item.ep ? <span>{item.ep}</span> : null}
          {timeLabel(item.s) ? <span>{timeLabel(item.s)}</span> : null}
        </div>
      </div>
      {compact ? (
        <div className="absolute left-2.5 top-2.5 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
          {item.bangumiTitle}
        </div>
      ) : null}
    </button>
  )
}

export function WindowExcerptOverlay({
  bangumis,
  points,
  activeBangumiId,
  activePointId,
  onBangumiClick,
  onPointClick,
  layout = 'desktop',
}: Props) {
  if (!bangumis.length && !points.length) return null

  if (layout === 'mobile') {
    return (
      <div className="pointer-events-none absolute inset-x-3 top-[max(72px,env(safe-area-inset-top,0px)+52px)] z-30 flex flex-col gap-2">
        {bangumis.length ? (
          <div className="pointer-events-auto -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {bangumis.map((item) => (
              <BangumiAvatar
                key={item.bangumiId}
                item={item}
                active={item.bangumiId === activeBangumiId}
                onClick={() => onBangumiClick(item.bangumiId)}
                compact
              />
            ))}
          </div>
        ) : null}

        {points.length ? (
          <div className="pointer-events-auto -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {points.map((item) => (
              <PointCard
                key={item.pointId}
                item={item}
                active={item.pointId === activePointId}
                onClick={() => onPointClick(item.bangumiId, item.pointId)}
                compact
              />
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-30 flex max-w-[360px] flex-col gap-3">
      {bangumis.length ? (
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {bangumis.map((item) => (
            <BangumiAvatar
              key={item.bangumiId}
              item={item}
              active={item.bangumiId === activeBangumiId}
              onClick={() => onBangumiClick(item.bangumiId)}
              compact={false}
            />
          ))}
        </div>
      ) : null}

      {points.length ? (
        <div className="pointer-events-auto grid grid-cols-3 gap-2 rounded-2xl border border-white/60 bg-white/85 p-2 shadow-2xl backdrop-blur">
          {points.map((item) => (
            <PointCard
              key={item.pointId}
              item={item}
              active={item.pointId === activePointId}
              onClick={() => onPointClick(item.bangumiId, item.pointId)}
              compact={false}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
