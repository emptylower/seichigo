'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DayLegsResult, DayRecord, RouteBookDetail } from '../types'
import { buildGoogleDirectionsUrl, dayLabel } from '../utils'
import type { useTripData } from '../hooks/useTripData'
import type { useTripDnd } from '../hooks/useTripDnd'
import type { DialogsHostApi } from './DialogsHost'
import { DayPillTrack } from './mobile/DayPillTrack'
import { MobilePlanView } from './mobile/MobilePlanView'
import { DaySummaryBar } from './mobile/DaySummaryBar'
import { MobileDock } from './mobile/MobileDock'
import { tr } from '../../i18n'

type Props = {
  header: ReactNode
  detail: RouteBookDetail
  days: DayRecord[]
  selectedDay: DayRecord | null
  selectedDayId: string | null
  onSelectDay: (dayId: string) => void
  onShowAll: () => void
  mapStage: ReactNode
  dragOverlay: ReactNode
  dnd: ReturnType<typeof useTripDnd>
  legsByDay: Record<string, DayLegsResult>
  legsFailedByDay: Record<string, boolean>
  onRetryLegs: (dayId: string) => void
  trip: ReturnType<typeof useTripData>
  dialogs: DialogsHostApi
  canStart: boolean
  startLabel: string
  /** true = 点「开始」先弹选天 sheet（无日期或未选天） */
  needsDayPick: boolean
  onOpenDayPicker: () => void
  onStartImmersive: () => void
  onOpenPoolSheet: () => void
  onOpenItemDetail: (itemId: string) => void
  onMoveItem: (itemId: string, targetDayId: string | null) => void
  onEditNote: (itemId: string) => void
  locale: SupportedLocale
}

/** 移动端编排（B3）：行程本选择器 → 天胶囊轨道 → 「计划 / 地图」切换 → 内容区 → 底部 dock */
export function MobileLayout({
  header,
  detail,
  days,
  selectedDay,
  selectedDayId,
  onSelectDay,
  onShowAll,
  mapStage,
  dragOverlay,
  dnd,
  legsByDay,
  legsFailedByDay,
  onRetryLegs,
  trip,
  dialogs,
  canStart,
  startLabel,
  needsDayPick,
  onOpenDayPicker,
  onStartImmersive,
  onOpenPoolSheet,
  onOpenItemDetail,
  onMoveItem,
  onEditNote,
  locale,
}: Props) {
  const [tab, setTab] = useState<'plan' | 'map'>('plan')
  const [unassignedView, setUnassignedView] = useState(false)

  const dayItems = useMemo(
    () =>
      selectedDay
        ? detail.items.filter((row) => row.dayId === selectedDay.id).sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [detail, selectedDay]
  )
  const unassignedItems = useMemo(
    () => detail.items.filter((row) => row.dayId === null).sort((a, b) => a.sortOrder - b.sortOrder),
    [detail]
  )

  const currentLegs = selectedDay ? legsByDay[selectedDay.id] : undefined

  // 优化可用性：可移动点 = 当天有坐标、非锚（locked && timeStart）的 point/place
  const movableCount = useMemo(() => {
    return dayItems.filter((item) => {
      if (item.kind !== 'point' && item.kind !== 'place') return false
      if (item.locked && item.timeStart) return false
      if (item.kind === 'place') return detail.places.some((place) => place.id === item.placeId)
      return Boolean(item.pointId && trip.getPointPreview(item.pointId).geo)
    }).length
  }, [dayItems, detail.places, trip])

  const navUrl = useMemo(() => {
    if (!selectedDay || !currentLegs || currentLegs.stops.length < 2) return null
    const stops = currentLegs.stops.map((stop) => `${stop.lat},${stop.lng}`)
    return buildGoogleDirectionsUrl(stops, selectedDay.defaultTravelMode === 'driving' ? 'driving' : 'transit')
  }, [currentLegs, selectedDay])

  const handleSelectDay = (dayId: string) => {
    setUnassignedView(false)
    onSelectDay(dayId)
  }

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={closestCenter}
      onDragStart={dnd.handleDragStart}
      onDragOver={dnd.handleDragOver}
      onDragEnd={(event) => {
        void dnd.handleDragEnd(event)
      }}
      onDragCancel={dnd.handleDragCancel}
    >
      <DragOverlay>{dragOverlay}</DragOverlay>

      <section className="space-y-4 pb-24">
        {header}

        <DayPillTrack
          days={days}
          selectedDayId={selectedDayId}
          unassignedSelected={unassignedView}
          unassignedCount={unassignedItems.length}
          onSelectDay={handleSelectDay}
          onShowAll={() => {
            setUnassignedView(false)
            onShowAll()
          }}
          onShowUnassigned={() => setUnassignedView(true)}
          locale={locale}
        />

        <div className="inline-flex w-full rounded-[26px] bg-pink-50/80 p-1">
          {([
            ['plan', tr('routebook.mobile.tabPlan', locale)],
            ['map', tr('routebook.mobile.tabMap', locale)],
          ] as const).map(([key, label]) => {
            const active = tab === key
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                className={`inline-flex min-h-12 flex-1 items-center justify-center rounded-[22px] px-3 text-sm font-semibold transition ${
                  active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            )
          })}
        </div>

        {tab === 'map' ? (
          mapStage
        ) : unassignedView ? (
          <MobilePlanView
            mode="unassigned"
            detail={detail}
            days={days}
            items={unassignedItems}
            getPointPreview={trip.getPointPreview}
            onUpdateItem={(itemId, data) => void trip.updateItem(itemId, data)}
            onDeleteItem={(itemId) => void trip.deleteItem(itemId)}
            onMoveItem={onMoveItem}
            onOpenItemDetail={onOpenItemDetail}
            onEditNote={onEditNote}
            locale={locale}
          />
        ) : selectedDay ? (
          <div className="space-y-3">
            <div className="px-1">
              <div className="flex items-baseline gap-2">
                <span className="text-base font-semibold text-slate-900">
                  {dayLabel(selectedDay, selectedDay.dayIndex, locale)}
                </span>
                {selectedDay.title ? <span className="truncate text-xs text-slate-400">{selectedDay.title}</span> : null}
              </div>
            </div>
            <DaySummaryBar
              day={selectedDay}
              items={dayItems}
              places={detail.places}
              lodgings={detail.lodgings}
              legs={currentLegs}
              onEditLodging={(lodgingId) => dialogs.openLodgingEditor({ lodgingId })}
              locale={locale}
            />
            <MobilePlanView
              mode="day"
              detail={detail}
              days={days}
              day={selectedDay}
              items={dayItems}
              getPointPreview={trip.getPointPreview}
              legs={currentLegs}
              legsFailed={Boolean(legsFailedByDay[selectedDay.id])}
              onRetryLegs={() => onRetryLegs(selectedDay.id)}
              onUpdateItem={(itemId, data) => void trip.updateItem(itemId, data)}
              onDeleteItem={(itemId) => void trip.deleteItem(itemId)}
              onMoveItem={onMoveItem}
              onOpenItemDetail={onOpenItemDetail}
              onEditNote={onEditNote}
              onAddNote={(dayId) => dialogs.openNoteEditor(dayId)}
              locale={locale}
            />
          </div>
        ) : (
          <MobilePlanView
            mode="all"
            detail={detail}
            days={days}
            items={[]}
            getPointPreview={trip.getPointPreview}
            onUpdateItem={(itemId, data) => void trip.updateItem(itemId, data)}
            onDeleteItem={(itemId) => void trip.deleteItem(itemId)}
            onMoveItem={onMoveItem}
            onEnterDay={handleSelectDay}
            locale={locale}
          />
        )}
      </section>

      <MobileDock
        selectedDay={unassignedView ? null : selectedDay}
        movableCount={movableCount}
        navUrl={unassignedView ? null : navUrl}
        canStart={canStart}
        startLabel={startLabel}
        needsDayPick={needsDayPick || unassignedView}
        onOpenPool={onOpenPoolSheet}
        onOptimize={() => {
          if (!selectedDay) return
          void trip.optimizeDay(selectedDay.id)
        }}
        onOpenDayPicker={onOpenDayPicker}
        onStart={onStartImmersive}
        locale={locale}
      />
    </DndContext>
  )
}
