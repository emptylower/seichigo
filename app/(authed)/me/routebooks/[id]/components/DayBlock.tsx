'use client'

import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CalendarDays, ChevronDown, ChevronRight, Navigation, Sparkles } from 'lucide-react'
import type { DayLegsResult, DayRecord, ItemRecord, PlaceRecord, PointPreview, TravelMode } from '../types'
import { TRAVEL_MODE_LABEL } from '../types'
import { buildGoogleDirectionsUrl, dayLabel, itemDragId } from '../utils'
import type { UpdateItemInput } from '../hooks/useTripData'
import { TimelineItem } from './TimelineItem'
import { LegConnector } from './LegConnector'

const STOP_MINUTES_ESTIMATE = 40

type DayBlockProps = {
  routeBookId: string
  day: DayRecord
  items: ItemRecord[]
  places: PlaceRecord[]
  days: DayRecord[]
  selected: boolean
  onSelect: () => void
  getPointPreview: (pointId: string) => PointPreview
  legs: DayLegsResult | undefined
  routeVisible: boolean
  onToggleRoute: () => void
  onOptimize: () => void
  onUpdateItem: (itemId: string, data: UpdateItemInput) => void
  onDeleteItem: (itemId: string) => void
  onMoveItem: (itemId: string, targetDayId: string | null) => void
  onUpdateDay: (dayId: string, data: { defaultTravelMode?: TravelMode }) => void
  expanded: boolean
  onToggleExpanded: () => void
}

export function DayBlock({
  routeBookId,
  day,
  items,
  places,
  days,
  selected,
  onSelect,
  getPointPreview,
  legs,
  routeVisible,
  onToggleRoute,
  onOptimize,
  onUpdateItem,
  onDeleteItem,
  onMoveItem,
  onUpdateDay,
  expanded,
  onToggleExpanded,
}: DayBlockProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.id}` })

  const legByToId = useMemo(() => {
    const map = new Map<string, DayLegsResult['legs'][number]>()
    for (const leg of legs?.legs ?? []) map.set(leg.toId, leg)
    return map
  }, [legs])

  const staleIds = useMemo(() => new Set(legs?.staleTransitItemIds ?? []), [legs])

  const stats = useMemo(() => {
    const visitable = items.filter((item) => item.kind === 'point' || item.kind === 'place')
    const coordCount = visitable.filter((item) => {
      if (item.kind === 'place') return places.some((place) => place.id === item.placeId)
      return Boolean(item.pointId && getPointPreview(item.pointId).geo)
    }).length
    const legMinutes = (legs?.legs ?? []).reduce((sum, leg) => sum + leg.durationSec / 60, 0)
    const totalHours = (legMinutes + visitable.length * STOP_MINUTES_ESTIMATE) / 60
    return { stopCount: visitable.length, coordCount, totalHours }
  }, [getPointPreview, items, legs, places])

  const navUrl = useMemo(() => {
    if (!legs || legs.stops.length < 2) return null
    const stops = legs.stops.map((stop) => `${stop.lat},${stop.lng}`)
    return buildGoogleDirectionsUrl(stops, day.defaultTravelMode === 'driving' ? 'driving' : 'transit')
  }, [day.defaultTravelMode, legs])

  const showToolbar = selected && stats.coordCount >= 2

  return (
    <section
      ref={setNodeRef}
      aria-label={dayLabel(day, day.dayIndex)}
      className={`rounded-[24px] border transition ${
        selected ? 'border-brand-200 bg-white shadow-[0_20px_36px_-30px_rgba(225,29,72,0.4)]' : 'border-pink-100/80 bg-white/80'
      } ${isOver ? 'ring-2 ring-brand-300/70' : ''}`}
    >
      <div
        role="button"
        tabIndex={0}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left"
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelect()
        }}
      >
        <button
          type="button"
          aria-label={expanded ? '折叠这一天' : '展开这一天'}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          onClick={(event) => {
            event.stopPropagation()
            onToggleExpanded()
          }}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-brand-500 text-white' : 'bg-pink-50 text-brand-500'}`}>
          <CalendarDays className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-slate-900">{dayLabel(day, day.dayIndex)}</span>
            {day.title ? <span className="truncate text-xs text-slate-400">{day.title}</span> : null}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {stats.stopCount} 站{stats.stopCount > 0 ? ` · 约 ${stats.totalHours.toFixed(1)} 小时` : ''}
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-1.5 px-2 pb-2">
          <SortableContext items={items.map((item) => itemDragId(item.id))} strategy={verticalListSortingStrategy}>
            {items.map((item) => (
              <div key={item.id}>
                {legByToId.has(item.id) ? (
                  <LegConnector leg={legByToId.get(item.id) ?? null} routeVisible={routeVisible} />
                ) : null}
                <TimelineItem
                  item={item}
                  preview={item.pointId ? getPointPreview(item.pointId) : null}
                  places={places}
                  days={days}
                  staleTransit={staleIds.has(item.id)}
                  onUpdate={(data) => onUpdateItem(item.id, data)}
                  onDelete={() => onDeleteItem(item.id)}
                  onMoveItem={(targetDayId) => onMoveItem(item.id, targetDayId)}
                />
              </div>
            ))}
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-pink-200 bg-pink-50/40 px-4 py-5 text-center text-xs text-slate-400">
                把点位拖到这里，或从点位池添加
              </div>
            ) : null}
          </SortableContext>

          {showToolbar ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl border border-pink-100/70 bg-pink-50/40 px-2 py-1.5">
              <button
                type="button"
                className={`inline-flex min-h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium transition ${
                  routeVisible ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 hover:bg-pink-100/60'
                }`}
                onClick={onToggleRoute}
              >
                路线{routeVisible ? '开' : '关'}
              </button>
              <button
                type="button"
                className="inline-flex min-h-8 items-center gap-1 rounded-xl bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-pink-100/60"
                onClick={onOptimize}
              >
                <Sparkles className="h-3.5 w-3.5 text-brand-500" />
                优化
              </button>
              {navUrl ? (
                <a
                  href={navUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-8 items-center gap-1 rounded-xl bg-white px-2.5 text-xs font-medium text-slate-600 no-underline transition hover:bg-pink-100/60"
                >
                  <Navigation className="h-3.5 w-3.5 text-brand-500" />
                  打开导航
                </a>
              ) : null}
              <span className="mx-1 h-4 w-px bg-pink-200/70" />
              {(['transit', 'walking', 'driving'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`inline-flex min-h-8 items-center rounded-xl px-2 text-xs font-medium transition ${
                    day.defaultTravelMode === mode ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-pink-100/60'
                  }`}
                  onClick={() => onUpdateDay(day.id, { defaultTravelMode: mode })}
                >
                  {TRAVEL_MODE_LABEL[mode]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
