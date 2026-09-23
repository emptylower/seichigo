'use client'

import type { ReactNode } from 'react'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DayLegsResult, DayRecord, ItemRecord, RouteBookDetail, RouteBookSummary } from '../types'
import type { useTripData } from '../hooks/useTripData'
import type { useTripDnd } from '../hooks/useTripDnd'
import type { DialogsHostApi } from './DialogsHost'
import { placeIntroLang } from './DetailChrome'
import { RouteBookPlannerHeader } from './RouteBookPlannerHeader'
import { DayDetailCard } from './DayDetailCard'
import { PlannerMapStage } from './PlannerMapStage'
import { PlannerPointPoolPanel } from './PlannerPointPoolPanel'
import { DayPlanSidebar } from './DayPlanSidebar'
import { DayBlock } from './DayBlock'
import { PointDetailCard } from './PointDetailCard'
import { tr } from '../../i18n'

export type PlannerNodesInput = {
  locale: SupportedLocale
  isMobile: boolean
  detail: RouteBookDetail
  days: DayRecord[]
  selectedDay: DayRecord | null
  selectedDayId: string | null
  selectedItem: ItemRecord | null
  trip: ReturnType<typeof useTripData>
  dialogs: DialogsHostApi
  dnd: ReturnType<typeof useTripDnd>
  legsByDay: Record<string, DayLegsResult>
  legsStaleDayIds: Record<string, boolean>
  legsFailedByDay: Record<string, boolean>
  onRetryLegs: (dayId: string) => void
  routeVisible: boolean
  onToggleRoute: () => void
  routeBookSelectorItems: RouteBookSummary[]
  startLabel: string
  canStart: boolean
  onStartImmersive: () => void
  /** 地图 marker 聚焦/选中（点位详情卡共用一个选中 id） */
  activePointId: string | null
  onPointSelect: (itemId: string) => void
  onSelectDay: (dayId: string) => void
  onShowAll: () => void
  onOpenItemDetail: (itemId: string) => void
  onCloseItemDetail: () => void
  onMoveItem: (itemId: string, targetDayId: string | null) => void
  onFocusPoint: (pointId: string) => void
  onEditNote: (itemId: string) => void
}

export type PlannerNodes = {
  header: ReactNode
  sidebar: ReactNode
  mapStage: ReactNode
  poolPanel: ReactNode
  /** 移动端路线 tab 内选中天的完整 DayBlock */
  mobileDayBlock: ReactNode
}

/** 桌面/移动端共享的面板节点拼装（纯函数，非 hook——调用点在 guards 之后） */
export function buildPlannerNodes(input: PlannerNodesInput): PlannerNodes {
  const {
    locale,
    isMobile,
    detail,
    days,
    selectedDay,
    selectedDayId,
    selectedItem,
    trip,
    dialogs,
    dnd,
    legsByDay,
    legsStaleDayIds,
    legsFailedByDay,
    onRetryLegs,
    routeVisible,
    onToggleRoute,
    routeBookSelectorItems,
    startLabel,
    canStart,
    onStartImmersive,
    onSelectDay,
    onShowAll,
    onOpenItemDetail,
    onCloseItemDetail,
    onMoveItem,
    onFocusPoint,
    onEditNote,
  } = input

  const header = <RouteBookPlannerHeader routeBookId={detail.id} routeBooks={routeBookSelectorItems} locale={locale} />

  const sidebar = (
    <DayPlanSidebar
      detail={detail}
      selectedDayId={selectedDayId}
      onSelectDay={onSelectDay}
      onShowAll={onShowAll}
      getPointPreview={trip.getPointPreview}
      legsByDay={legsByDay}
      routeVisible={routeVisible}
      onToggleRoute={onToggleRoute}
      onOptimize={(dayId) => void trip.optimizeDay(dayId)}
      onUndo={() => void trip.undo()}
      undoLabel={trip.undoLabel}
      onAddItem={(dayId, itemInput, index) => void trip.addItem(dayId, itemInput, index)}
      onUpdateItem={(itemId, data) => void trip.updateItem(itemId, data)}
      onDeleteItem={(itemId) => void trip.deleteItem(itemId)}
      onReorder={(dayId, ids) => void trip.reorder(dayId, ids)}
      onUpdateDay={(dayId, data) => void trip.updateDay(dayId, data)}
      onInsertDay={(after) => void trip.insertDay(after)}
      onDeleteDay={(dayId) => void trip.deleteDay(dayId)}
      onOpenDayOrder={dialogs.openDayOrder}
      onOpenItemDetail={onOpenItemDetail}
      onAddLodging={(dayIndex) => dialogs.openLodgingEditor({ presetDayIndex: dayIndex })}
      onEditLodging={(lodgingId) => dialogs.openLodgingEditor({ lodgingId })}
      onAddNote={(dayId) => dialogs.openNoteEditor(dayId)}
      onEditNote={onEditNote}
      limitBlockedDayId={dnd.limitBlockedDayId}
      legsFailedByDay={legsFailedByDay}
      onRetryLegs={onRetryLegs}
      locale={locale}
    />
  )

  const detailCard = selectedItem ? (
    <PointDetailCard
      routeBookId={detail.id}
      item={selectedItem}
      preview={selectedItem.pointId ? trip.getPointPreview(selectedItem.pointId) : null}
      place={selectedItem.placeId ? detail.places.find((row) => row.id === selectedItem.placeId) ?? null : null}
      days={days}
      lang={placeIntroLang(locale)}
      locale={locale}
      compact={isMobile}
      onClose={onCloseItemDetail}
      onDelete={() => {
        void trip.deleteItem(selectedItem.id)
        onCloseItemDetail()
      }}
      onMoveItem={(targetDayId) => {
        onMoveItem(selectedItem.id, targetDayId)
        onCloseItemDetail()
      }}
    />
  ) : null

  const mapStage = (
    <PlannerMapStage
      detail={detail}
      selectedDayId={selectedDayId}
      getPointPreview={trip.getPointPreview}
      legsByDay={legsByDay}
      legsStale={selectedDayId ? Boolean(legsStaleDayIds[selectedDayId]) : false}
      legsFailed={selectedDayId ? Boolean(legsFailedByDay[selectedDayId]) : false}
      routeVisible={routeVisible}
      compact={isMobile}
      startLabel={startLabel}
      startDisabled={!canStart}
      onStartImmersive={onStartImmersive}
      activePointId={input.activePointId}
      onPointSelect={input.onPointSelect}
      detailCard={detailCard}
      dayDetailCard={
        <DayDetailCard
          day={selectedDay}
          lodgings={detail.lodgings}
          places={detail.places}
          onEditLodging={(lodgingId) => dialogs.openLodgingEditor({ lodgingId })}
          locale={locale}
        />
      }
      onMapContextMenu={(pos) => dialogs.openPlaceEditor({ initialCoords: { lat: pos.lat, lng: pos.lng } })}
      locale={locale}
    />
  )

  const poolPanel = (
    <PlannerPointPoolPanel
      detail={detail}
      pointPoolItems={trip.pointPoolItems}
      selectedDayId={selectedDayId}
      getPointPreview={trip.getPointPreview}
      onAddItem={(dayId, itemInput) => void trip.addItem(dayId, itemInput)}
      onReorder={(dayId, ids) => void trip.reorder(dayId, ids)}
      onFocusPoint={onFocusPoint}
      onRemoveFromPool={(pointId) => void trip.removeFromPool(pointId)}
      onCreatePlace={() => dialogs.openPlaceEditor()}
      onEditPlace={(placeId) => dialogs.openPlaceEditor({ placeId })}
      onDeletePlace={(placeId) => void trip.deletePlace(placeId)}
      onNeedDay={() => trip.showToast(tr('routebook.pool.pickDayFirst', locale))}
      compact={isMobile}
      enableDrag={!isMobile}
      locale={locale}
    />
  )

  const mobileDayBlock = selectedDay ? (
    <DayBlock
      routeBookId={detail.id}
      day={selectedDay}
      items={detail.items
        .filter((row) => row.dayId === selectedDay.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)}
      places={detail.places}
      days={days}
      selected
      onSelect={() => {}}
      getPointPreview={trip.getPointPreview}
      legs={legsByDay[selectedDay.id]}
      routeVisible={routeVisible}
      onToggleRoute={onToggleRoute}
      onOptimize={() => void trip.optimizeDay(selectedDay.id)}
      onUpdateItem={(itemId, data) => void trip.updateItem(itemId, data)}
      onDeleteItem={(itemId) => void trip.deleteItem(itemId)}
      onMoveItem={onMoveItem}
      onUpdateDay={(dayId, data) => void trip.updateDay(dayId, data)}
      onOpenItemDetail={onOpenItemDetail}
      lodgings={detail.lodgings}
      onAddLodging={(dayIndex) => dialogs.openLodgingEditor({ presetDayIndex: dayIndex })}
      onEditLodging={(lodgingId) => dialogs.openLodgingEditor({ lodgingId })}
      onAddNote={(dayId) => dialogs.openNoteEditor(dayId)}
      onEditNote={onEditNote}
      expanded
      onToggleExpanded={() => {}}
      legsFailed={Boolean(legsFailedByDay[selectedDay.id])}
      onRetryLegs={() => onRetryLegs(selectedDay.id)}
      locale={locale}
    />
  ) : null

  return { header, sidebar, mapStage, poolPanel, mobileDayBlock }
}
