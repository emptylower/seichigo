'use client'

import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { BedDouble, CalendarDays, ChevronDown, ChevronRight, Sparkles, StickyNote } from 'lucide-react'
import type { DayLegsResult, DayRecord, ItemRecord, LodgingRecord, PlaceRecord, PointPreview, TravelMode } from '../types'
import type { SupportedLocale } from '@/lib/i18n/types'
import { computeVisitOrder, dayLabel, dayNavTargets, dayStats, itemDragId } from '../utils'
import type { WeatherDay } from '../hooks/useWeather'
import { OpenInMapsMenu } from '@/components/navigation/OpenInMapsMenu'
import { WeatherBadge } from './WeatherBadge'
import type { UpdateItemInput } from '../hooks/useTripData'
import { TimelineItem } from './TimelineItem'
import { LegConnector } from './LegConnector'
import { lodgingsForDay } from './DayDetailCard'
import { tr } from '../../i18n'

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
  /** B4：点时间线条目（point/place）打开详情卡 */
  onOpenItemDetail?: (itemId: string) => void
  /** B2：住宿徽标 + 「添加住宿」 */
  lodgings?: LodgingRecord[]
  onAddLodging?: (dayIndex: number) => void
  onEditLodging?: (lodgingId: string) => void
  /** B2：「+ 备注」打开备注编辑弹窗 */
  onAddNote?: (dayId: string) => void
  /** B2 修复：note 卡片「编辑」入口 */
  onEditNote?: (itemId: string) => void
  expanded: boolean
  onToggleExpanded: () => void
  /** 拖拽悬停时这一天 point/place 已达 25 条上限：置灰提示不可投放 */
  dropBlocked?: boolean
  /** B1.2：该天 legs 两次加载失败：连接行显示「加载失败 · 重试」 */
  legsFailed?: boolean
  onRetryLegs?: () => void
  /** B4：当天天气（有日期且在预报范围内才有） */
  weather?: WeatherDay | null
  locale?: SupportedLocale
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
  onOpenItemDetail,
  lodgings = [],
  onAddLodging,
  onEditLodging,
  onAddNote,
  onEditNote,
  expanded,
  onToggleExpanded,
  dropBlocked = false,
  legsFailed = false,
  onRetryLegs,
  weather = null,
  locale = 'zh',
}: DayBlockProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.id}` })

  const legByToId = useMemo(() => {
    const map = new Map<string, DayLegsResult['legs'][number]>()
    for (const leg of legs?.legs ?? []) map.set(leg.toId, leg)
    return map
  }, [legs])

  const staleIds = useMemo(() => new Set(legs?.staleTransitItemIds ?? []), [legs])

  // 时间线条目序号 = 单天模式地图徽标（有坐标的 point/place 按 sortOrder 编 1..N）
  const visitOrder = useMemo(
    () => computeVisitOrder(items, places, getPointPreview),
    [items, places, getPointPreview]
  )

  const stats = useMemo(() => dayStats(items, legs, places, getPointPreview), [getPointPreview, items, legs, places])

  const navTargets = useMemo(
    () => dayNavTargets(day, legs, items, places, getPointPreview, locale),
    [day, getPointPreview, items, legs, locale, places]
  )

  const showToolbar = selected && stats.coordCount >= 2

  // 住宿徽标：入住日绿 / 退房日红 / 住中灰（from==to 当天锚同时显示入住+退房）
  const lodgingBadges = useMemo(() => {
    const rows: { id: string; placeTitle: string; badgeKey: 'badgeCheckIn' | 'badgeCheckOut' | 'badgeStaying' }[] = []
    for (const lodging of lodgingsForDay(lodgings, day.dayIndex)) {
      const placeTitle =
        places.find((row) => row.id === lodging.placeId)?.title ?? tr('routebook.common.placeFallback', locale)
      if (lodging.fromDayIndex === day.dayIndex) rows.push({ id: lodging.id, placeTitle, badgeKey: 'badgeCheckIn' })
      if (lodging.fromDayIndex < day.dayIndex && day.dayIndex < lodging.toDayIndex)
        rows.push({ id: lodging.id, placeTitle, badgeKey: 'badgeStaying' })
      if (lodging.toDayIndex === day.dayIndex && lodging.toDayIndex !== lodging.fromDayIndex)
        rows.push({ id: lodging.id, placeTitle, badgeKey: 'badgeCheckOut' })
    }
    return rows
  }, [day.dayIndex, locale, lodgings, places])

  return (
    <section
      ref={setNodeRef}
      aria-label={dayLabel(day, day.dayIndex, locale)}
      className={`rounded-[24px] border transition ${
        selected ? 'border-brand-200 bg-white shadow-[0_20px_36px_-30px_rgba(225,29,72,0.4)]' : 'border-pink-100/80 bg-white/80'
      } ${isOver ? 'ring-2 ring-brand-300/70' : ''} ${dropBlocked ? 'opacity-50 saturate-50' : ''}`}
    >
      {dropBlocked ? (
        <div className="mx-2 mt-2 rounded-xl bg-slate-100 px-3 py-1.5 text-center text-[11px] font-medium text-slate-500">
          {tr('routebook.sidebar.dayLimit', locale)}
        </div>
      ) : null}
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
          aria-label={expanded ? tr('routebook.sidebar.collapseDay', locale) : tr('routebook.sidebar.expandDay', locale)}
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
            <span className="text-sm font-semibold text-slate-900">{dayLabel(day, day.dayIndex, locale)}</span>
            {day.title ? <span className="truncate text-xs text-slate-400">{day.title}</span> : null}
            {weather ? <WeatherBadge weather={weather} locale={locale} className="ml-auto shrink-0" /> : null}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {tr('routebook.common.stopCount', locale, { n: stats.stopCount })}
            {stats.stopCount > 0 ? tr('routebook.sidebar.dayStatsHours', locale, { h: stats.totalHours.toFixed(1) }) : ''}
          </div>
          {lodgingBadges.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {lodgingBadges.map((badge) => (
                <button
                  key={`${badge.id}:${badge.badgeKey}`}
                  type="button"
                  disabled={!onEditLodging}
                  title={badge.placeTitle}
                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition disabled:cursor-default ${
                    badge.badgeKey === 'badgeCheckIn'
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200/70'
                      : badge.badgeKey === 'badgeCheckOut'
                        ? 'bg-rose-100 text-rose-600 hover:bg-rose-200/70'
                        : 'bg-slate-200/70 text-slate-500 hover:bg-slate-300/60'
                  }`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onEditLodging?.(badge.id)
                  }}
                >
                  <BedDouble className="h-3 w-3" />
                  {tr(`routebook.lodging.${badge.badgeKey}`, locale)}
                  <span className="max-w-24 truncate font-normal">{badge.placeTitle}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {onAddLodging ? (
          <button
            type="button"
            aria-label={tr('routebook.lodging.add', locale)}
            title={tr('routebook.lodging.add', locale)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-emerald-50 hover:text-emerald-600"
            onClick={(event) => {
              event.stopPropagation()
              onAddLodging(day.dayIndex)
            }}
          >
            <BedDouble className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="space-y-1.5 px-2 pb-2">
          {legsFailed ? (
            <div className="flex items-stretch gap-3 py-0.5 pl-5">
              <div className="flex w-5 justify-center">
                <span className="w-px bg-rose-200" />
              </div>
              <button
                type="button"
                className="my-1 inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-600 transition hover:bg-rose-100"
                onClick={onRetryLegs}
              >
                {tr('routebook.detail.legsFailed', locale)} · {tr('routebook.common.retry', locale)}
              </button>
            </div>
          ) : null}
          <SortableContext items={items.map((item) => itemDragId(item.id))} strategy={verticalListSortingStrategy}>
            {items.map((item) => (
              <div key={item.id}>
                {legByToId.has(item.id) ? (
                  <LegConnector
                    leg={legByToId.get(item.id) ?? null}
                    routeVisible={routeVisible}
                    itemLegMode={item.legMode}
                    onChangeLegMode={(mode) => onUpdateItem(item.id, { legMode: mode })}
                    locale={locale}
                  />
                ) : null}
                <TimelineItem
                  item={item}
                  preview={item.pointId ? getPointPreview(item.pointId) : null}
                  places={places}
                  days={days}
                  staleTransit={staleIds.has(item.id)}
                  seq={visitOrder.get(item.id)}
                  onUpdate={(data) => onUpdateItem(item.id, data)}
                  onDelete={() => onDeleteItem(item.id)}
                  onMoveItem={(targetDayId) => onMoveItem(item.id, targetDayId)}
                  onEditNote={item.kind === 'note' && onEditNote ? () => onEditNote(item.id) : undefined}
                  onOpenDetail={
                    (item.kind === 'point' || item.kind === 'place') && onOpenItemDetail
                      ? () => onOpenItemDetail(item.id)
                      : undefined
                  }
                  locale={locale}
                />
              </div>
            ))}
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-pink-200 bg-pink-50/40 px-4 py-5 text-center text-xs text-slate-400">
                {tr('routebook.sidebar.dropHint', locale)}
              </div>
            ) : null}
          </SortableContext>

          {onAddNote ? (
            <button
              type="button"
              className="mt-1 inline-flex min-h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-slate-500 transition hover:bg-pink-100/60 hover:text-slate-700"
              onClick={() => onAddNote(day.id)}
            >
              <StickyNote className="h-3.5 w-3.5 text-brand-400" />
              {tr('routebook.note.add', locale)}
            </button>
          ) : null}

          {showToolbar ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl border border-pink-100/70 bg-pink-50/40 px-2 py-1.5">
              <button
                type="button"
                className={`inline-flex min-h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium transition ${
                  routeVisible ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 hover:bg-pink-100/60'
                }`}
                onClick={onToggleRoute}
              >
                {routeVisible ? tr('routebook.sidebar.routeOn', locale) : tr('routebook.sidebar.routeOff', locale)}
              </button>
              <button
                type="button"
                className="inline-flex min-h-8 items-center gap-1 rounded-xl bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-pink-100/60"
                onClick={onOptimize}
              >
                <Sparkles className="h-3.5 w-3.5 text-brand-500" />
                {tr('routebook.sidebar.optimize', locale)}
              </button>
              {navTargets.length > 0 ? (
                <OpenInMapsMenu targets={navTargets} locale={locale} label={tr('routebook.sidebar.openNav', locale)} />
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
                  {tr(`routebook.travelMode.${mode}`, locale)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
