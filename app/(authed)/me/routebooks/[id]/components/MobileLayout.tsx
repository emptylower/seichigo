'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DayLegsResult, DayRecord, PointPoolItem, RouteBookDetail } from '../types'
import { dayLabel, dayNavTargets, movableCount as countMovable } from '../utils'
import { defaultMaxNavigationWaypoints } from '@/lib/route/navigationTargets'
import { weatherForDay, type WeatherByDate } from '../hooks/useWeather'
import type { useTripData } from '../hooks/useTripData'
import type { useTripDnd } from '../hooks/useTripDnd'
import type { DialogsHostApi } from './DialogsHost'
import { DayPillTrack } from './mobile/DayPillTrack'
import { MobilePlanView } from './mobile/MobilePlanView'
import { DaySummaryBar } from './mobile/DaySummaryBar'
import { MobileDock } from './mobile/MobileDock'
import { MobilePointPoolSheet } from './MobilePointPoolSheet'
import { tr } from '../../i18n'

type Props = {
  header: ReactNode
  detail: RouteBookDetail
  days: DayRecord[]
  selectedDay: DayRecord | null
  selectedDayId: string | null
  /** 胶囊是 tab 语义：点已选中的天保持选中（非切换）；只有「全部」清空 */
  onSelectDay: (dayId: string) => void
  onShowAll: () => void
  mapStage: ReactNode
  /** 点位详情卡：两个 tab 下都以固定底部抽屉渲染 */
  detailCard: ReactNode
  /** 点位池 sheet 列表（已排除本行程本已有点位） */
  poolItems: PointPoolItem[]
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
  onOpenItemDetail: (itemId: string) => void
  onMoveItem: (itemId: string, targetDayId: string | null) => void
  onEditNote: (itemId: string) => void
  /** B4：按 YYYY-MM-DD 的天气 */
  weatherByDate?: WeatherByDate
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
  detailCard,
  poolItems,
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
  onOpenItemDetail,
  onMoveItem,
  onEditNote,
  weatherByDate = {},
  locale,
}: Props) {
  const [tab, setTab] = useState<'plan' | 'map'>('plan')
  const [unassignedView, setUnassignedView] = useState(false)
  const [poolOpen, setPoolOpen] = useState(false)

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

  const movableCount = useMemo(
    () => countMovable(dayItems, detail.places, trip.getPointPreview),
    [dayItems, detail.places, trip.getPointPreview]
  )

  // Google waypoints 上限：移动端 3（effect 里读 matchMedia，首屏按桌面 9 避免 hydration 差异）
  const [maxWaypoints, setMaxWaypoints] = useState(9)
  useEffect(() => {
    setMaxWaypoints(defaultMaxNavigationWaypoints())
  }, [])

  const navTargets = useMemo(
    () =>
      selectedDay
        ? dayNavTargets(selectedDay, currentLegs, dayItems, detail.places, trip.getPointPreview, locale, maxWaypoints)
        : [],
    [currentLegs, dayItems, detail.places, locale, maxWaypoints, selectedDay, trip.getPointPreview]
  )
  const hasDates = days.some((day) => Boolean(day.date))

  // 切回地图 tab：地图一直挂着（hidden 切换），可见后通知 MapLibre 重算尺寸
  useEffect(() => {
    if (tab !== 'map') return
    const frame = window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => window.cancelAnimationFrame(frame)
  }, [tab])

  const handleSelectDay = (dayId: string) => {
    setUnassignedView(false)
    onSelectDay(dayId)
  }

  // 进入「未安排」视图：同时清掉选中天（地图回到全览，不残留旧天）
  const handleShowUnassigned = () => {
    setUnassignedView(true)
    onShowAll()
  }

  // 点位池加入目标：未安排视图 / 全部 → 未安排；否则选中天
  const poolTargetDayId = unassignedView ? null : selectedDayId
  const poolTargetDay = poolTargetDayId ? selectedDay : null
  const poolTargetLabel = poolTargetDay ? `Day ${poolTargetDay.dayIndex}` : tr('routebook.common.unassigned', locale)

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

      <section className="space-y-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
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
          onShowUnassigned={handleShowUnassigned}
          weatherByDate={weatherByDate}
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

        {/* 两个视图都保持挂载（切 tab 不重建地图），非活动的 hidden */}
        <div className={tab === 'map' ? '' : 'hidden'} data-testid="mobile-map-view">
          {mapStage}
        </div>

        <div className={tab === 'plan' ? '' : 'hidden'} data-testid="mobile-plan-view">
          {unassignedView ? (
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
                getPointPreview={trip.getPointPreview}
                onEditLodging={(lodgingId) => dialogs.openLodgingEditor({ lodgingId })}
                onAddLodging={(dayIndex) => dialogs.openLodgingEditor({ presetDayIndex: dayIndex })}
                weather={weatherForDay(weatherByDate, selectedDay)}
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
        </div>
      </section>

      {/* 点位详情卡：固定底部抽屉（dock 之上），计划 / 地图两个 tab 都可见 */}
      {detailCard ? (
        <div
          data-testid="mobile-detail-drawer"
          className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[45] h-[70dvh]"
        >
          {detailCard}
        </div>
      ) : null}

      <MobileDock
        selectedDay={unassignedView ? null : selectedDay}
        movableCount={movableCount}
        navTargets={unassignedView ? [] : navTargets}
        routeBookId={detail.id}
        selectedDayIndex={unassignedView ? null : selectedDay?.dayIndex ?? null}
        hasDates={hasDates}
        canStart={canStart}
        startLabel={startLabel}
        needsDayPick={needsDayPick || unassignedView}
        onOpenPool={() => setPoolOpen(true)}
        onOptimize={() => {
          if (!selectedDay) return
          void trip.optimizeDay(selectedDay.id)
        }}
        onOpenDayPicker={onOpenDayPicker}
        onStart={onStartImmersive}
        onChangeTravelMode={(mode) => {
          if (!selectedDay) return
          void trip.updateDay(selectedDay.id, { defaultTravelMode: mode })
        }}
        locale={locale}
      />

      <MobilePointPoolSheet
        pointPoolItems={poolItems}
        getPointPreview={trip.getPointPreview}
        onAddToRoute={(pointId) => {
          void trip.addItem(poolTargetDayId, { kind: 'point', pointId })
        }}
        onRemoveFromPool={(pointId) => void trip.removeFromPool(pointId)}
        detail={detail}
        onAddPlace={(placeId) => {
          void trip.addItem(poolTargetDayId, { kind: 'place', placeId })
        }}
        onCreatePlace={() => dialogs.openPlaceEditor()}
        onEditPlace={(placeId) => dialogs.openPlaceEditor({ placeId })}
        onDeletePlace={(placeId) => void trip.deletePlace(placeId)}
        isOpen={poolOpen}
        onClose={() => setPoolOpen(false)}
        targetLabel={poolTargetLabel}
        locale={locale}
      />
    </DndContext>
  )
}
