'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { SupportedLocale } from '@/lib/i18n/types'
import { tr } from '../i18n'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { useTripData } from './hooks/useTripData'
import { useTripDnd } from './hooks/useTripDnd'
import { useDayLegs } from './hooks/useDayLegs'
import { useWeather } from './hooks/useWeather'
import { dayLabel, nextDayFirstStopTitle, sequenceForImmersive } from './utils'
import {
  DetailNav,
  NoticeBanners,
  PlannerDragOverlay,
  RouteBookDetailError,
  RouteBookDetailSkeleton,
  formatImportSummary,
  parseImportCounts,
} from './components/DetailChrome'
import { useDialogsHost } from './components/DialogsHost'
import { buildPlannerNodes } from './components/plannerNodes'
import { DesktopLayout } from './components/DesktopLayout'
import { MobileLayout } from './components/MobileLayout'
import { RouteBookImmersiveMode } from './components/RouteBookImmersiveMode'
import { StartDayPickerSheet } from './components/StartDayPickerSheet'

export default function RouteBookDetailClient({ id, locale = 'zh' }: { id: string; locale?: SupportedLocale }) {
  const isMobile = useIsMobile()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showImmersive, setShowImmersive] = useState(false)
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null)
  const [routeVisible, setRouteVisible] = useState(true)
  const [focusItemId, setFocusItemId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<string | null>(null)
  const [startDayPickerOpen, setStartDayPickerOpen] = useState(false)
  const pendingStartRef = useRef(false)

  // /plan 导入跳转带回的一次性提示条：读出即清参数
  useEffect(() => {
    const counts = parseImportCounts(searchParams.get('imported'))
    if (!counts) return
    setImportSummary(formatImportSummary(counts, locale))
    router.replace(`/me/routebooks/${id}`, { scroll: false })
  }, [id, locale, router, searchParams])

  const trip = useTripData(id, locale)
  const detail = trip.detail
  // 移动端连接行始终显示（无路线开关），legs 常拉
  const { legsByDay, staleDayIds, failedDayIds, retryDay } = useDayLegs(id, detail, selectedDayId, routeVisible || isMobile)
  const weatherByDate = useWeather(detail, trip.getPointPreview)
  const dialogs = useDialogsHost({
    detail,
    createPlace: trip.createPlace,
    updatePlace: trip.updatePlace,
    createLodging: trip.createLodging,
    updateLodging: trip.updateLodging,
    deleteLodging: trip.deleteLodging,
    addItem: trip.addItem,
    updateItem: trip.updateItem,
    insertDay: trip.insertDay,
    deleteDay: trip.deleteDay,
    reorderDays: trip.reorderDays,
    locale,
  })
  const dnd = useTripDnd({
    items: detail?.items ?? [],
    pointPoolItems: trip.pointPoolItems,
    reorder: trip.reorder,
    addItem: trip.addItem,
    onLimitBlocked: () => trip.showToast(tr('routebook.detail.dayLimitToast', locale)),
  })

  // 已选天被删除等场景下回退到「全部」模式
  useEffect(() => {
    if (!detail) return
    if (selectedDayId && !detail.days.some((day) => day.id === selectedDayId)) {
      setSelectedDayId(null)
    }
  }, [detail, selectedDayId])

  const days = useMemo(
    () => (detail ? [...detail.days].sort((a, b) => a.dayIndex - b.dayIndex) : []),
    [detail]
  )
  const selectedDay = days.find((day) => day.id === selectedDayId) ?? null

  const immersiveSequence = useMemo(
    () => (detail && selectedDayId ? sequenceForImmersive(detail.items, selectedDayId) : []),
    [detail, selectedDayId]
  )

  const nextDayFirstTitle = useMemo(
    () => (detail && selectedDay ? nextDayFirstStopTitle(detail, selectedDay, trip.getPointPreview) : null),
    [detail, selectedDay, trip.getPointPreview]
  )

  const routeBookSelectorItems = useMemo(() => {
    if (!detail) return trip.routeBooks
    if (trip.routeBooks.some((item) => item.id === detail.id)) return trip.routeBooks
    return [
      {
        id: detail.id,
        title: detail.title,
        status: detail.status,
        metadata: detail.metadata,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      },
      ...trip.routeBooks,
    ]
  }, [detail, trip.routeBooks])

  const bookPointIds = useMemo(
    () => new Set((detail?.items ?? []).map((item) => item.pointId).filter((v): v is string => Boolean(v))),
    [detail]
  )

  const sheetPoolItems = useMemo(
    () => trip.pointPoolItems.filter((item) => !bookPointIds.has(item.pointId)),
    [trip.pointPoolItems, bookPointIds]
  )

  // 无日期或全部模式：点「开始」先弹选天 sheet，由用户挑天开始
  const isDateless = Boolean(detail && !detail.startDate)
  const canStart = detail
    ? isDateless || selectedDayId === null
      ? detail.days.some((day) => sequenceForImmersive(detail.items, day.id).length > 0)
      : immersiveSequence.length > 0
    : false

  const startLabel = selectedDay
    ? tr('routebook.detail.startDay', locale, { n: selectedDay.dayIndex })
    : tr('routebook.detail.startNav', locale)

  const beginImmersive = async () => {
    if (!detail) return
    if (detail.status === 'draft') {
      await trip.patchBook({ status: 'in_progress' })
    }
    setShowImmersive(true)
  }

  const handleStartImmersive = async () => {
    if (!detail || !canStart) return
    if (isDateless || !selectedDay) {
      setStartDayPickerOpen(true)
      return
    }
    if (!immersiveSequence.length) return
    await beginImmersive()
  }

  const handlePickStartDay = (dayId: string) => {
    setStartDayPickerOpen(false)
    pendingStartRef.current = true
    setSelectedDayId(dayId)
  }

  // 选天后等 selectedDayId/immersiveSequence 生效再开始；选到空天提示并取消
  useEffect(() => {
    if (!pendingStartRef.current) return
    if (!detail) {
      pendingStartRef.current = false
      return
    }
    if (!immersiveSequence.length) {
      pendingStartRef.current = false
      trip.showToast(tr('routebook.detail.emptyDayToast', locale))
      return
    }
    pendingStartRef.current = false
    void beginImmersive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, immersiveSequence])

  const handleFocusPoint = (pointId: string) => {
    if (!detail) return
    const candidates = detail.items.filter((row) => row.kind === 'point' && row.pointId === pointId)
    const onSelected = candidates.find((row) => row.dayId === selectedDayId)
    setFocusItemId((onSelected ?? candidates[0])?.id ?? null)
  }

  // B4：点位详情卡——marker/时间线条目共用一个选中 id；再点同一 marker 关闭
  const handleSelectItem = (itemId: string) => {
    setSelectedItemId((prev) => (prev === itemId ? null : itemId))
    setFocusItemId(itemId)
  }

  const handleOpenItemDetail = (itemId: string) => {
    setSelectedItemId(itemId)
    setFocusItemId(itemId)
  }

  const handleCloseItemDetail = () => {
    setSelectedItemId(null)
  }

  // 切天/删除条目后关掉已失效的详情卡
  useEffect(() => {
    if (!selectedItemId) return
    if (!detail) return
    const item = detail.items.find((row) => row.id === selectedItemId)
    if (!item) {
      setSelectedItemId(null)
      return
    }
    if (selectedDayId !== null && item.dayId !== selectedDayId) {
      setSelectedItemId(null)
    }
  }, [detail, selectedDayId, selectedItemId])

  const selectedItem = useMemo(() => {
    if (!selectedItemId || !detail) return null
    const item = detail.items.find((row) => row.id === selectedItemId)
    if (!item) return null
    if (item.kind !== 'point' && item.kind !== 'place') return null
    return item
  }, [detail, selectedItemId])

  const handleMoveItem = (itemId: string, targetDayId: string | null) => {
    if (!detail) return
    const orderedIds = detail.items
      .filter((row) => row.dayId === targetDayId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => row.id)
      .filter((rowId) => rowId !== itemId)
    void trip.reorder(targetDayId, [...orderedIds, itemId])
  }

  const handleEditNote = (itemId: string) => {
    if (!detail) return
    const item = detail.items.find((row) => row.id === itemId)
    if (!item || item.kind !== 'note') return
    dialogs.openNoteEditor(item.dayId, item.id)
  }

  if (trip.loading) return <RouteBookDetailSkeleton />
  if (trip.error) return <RouteBookDetailError error={trip.error} locale={locale} />
  if (!detail) return null

  // 桌面侧栏：再点已选中的天回到「全部」；移动端胶囊是 tab 语义，见 MobileLayout 的 onSelectDay
  const handleSelectDay = (dayId: string) => {
    setSelectedDayId((prev) => (prev === dayId ? null : dayId))
  }

  const nodes = buildPlannerNodes({
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
    legsStaleDayIds: staleDayIds,
    legsFailedByDay: failedDayIds,
    onRetryLegs: retryDay,
    routeVisible,
    onToggleRoute: () => setRouteVisible((prev) => !prev),
    routeBookSelectorItems,
    startLabel,
    canStart,
    onStartImmersive: () => void handleStartImmersive(),
    activePointId: focusItemId,
    onPointSelect: handleSelectItem,
    onSelectDay: handleSelectDay,
    onShowAll: () => setSelectedDayId(null),
    onOpenItemDetail: handleOpenItemDetail,
    onCloseItemDetail: handleCloseItemDetail,
    onMoveItem: handleMoveItem,
    onFocusPoint: handleFocusPoint,
    onEditNote: handleEditNote,
    weatherByDate,
  })

  return (
    <div data-layout-wide="true" className="min-h-[70dvh] bg-[linear-gradient(180deg,#fffafc_0%,#fff5f9_100%)]">
      <DetailNav
        title={detail.title}
        editing={trip.editingTitle}
        draft={trip.titleDraft}
        onDraftChange={trip.setTitleDraft}
        onSave={() => void trip.handleTitleSave()}
        onStartEdit={() => {
          trip.setTitleDraft(detail.title)
          trip.setEditingTitle(true)
        }}
        onCancelEdit={() => {
          trip.setTitleDraft(detail.title)
          trip.setEditingTitle(false)
        }}
        startDate={detail.startDate}
        onSaveStartDate={(startDate) => trip.patchBook({ startDate })}
        locale={locale}
      />

      <div className="mx-auto max-w-[1920px] space-y-5 px-4 py-5 sm:px-6">
        <NoticeBanners
          staleNotice={trip.staleNotice}
          importSummary={importSummary}
          onReload={() => void trip.reload()}
          onDismissStale={trip.dismissStale}
          onDismissImport={() => setImportSummary(null)}
          locale={locale}
        />
        {showImmersive && selectedDay ? (
          <RouteBookImmersiveMode
            routeBookTitle={detail.title}
            sequence={immersiveSequence}
            places={detail.places}
            dayLabel={dayLabel(selectedDay, selectedDay.dayIndex, locale)}
            nextDayFirstTitle={nextDayFirstTitle}
            checkedInPointIds={trip.checkedInPointIds}
            getPointPreview={trip.getPointPreview}
            onCheckInSuccess={trip.markPointCheckedIn}
            onUndoCheckIn={trip.unmarkPointCheckedIn}
            onClose={() => setShowImmersive(false)}
            locale={locale}
          />
        ) : null}

        {!isMobile ? (
          <DesktopLayout
            header={nodes.header}
            sidebar={nodes.sidebar}
            mapStage={nodes.mapStage}
            poolPanel={nodes.poolPanel}
            dnd={dnd}
            dragOverlay={
              <PlannerDragOverlay
                activeDragId={dnd.activeDragId}
                detail={detail}
                pointPoolItems={trip.pointPoolItems}
                getPointPreview={trip.getPointPreview}
                locale={locale}
              />
            }
          />
        ) : (
          <MobileLayout
            header={nodes.header}
            detail={detail}
            days={days}
            selectedDay={selectedDay}
            selectedDayId={selectedDayId}
            onSelectDay={(dayId) => setSelectedDayId(dayId)}
            onShowAll={() => setSelectedDayId(null)}
            mapStage={nodes.mapStage}
            detailCard={nodes.detailCard}
            poolItems={sheetPoolItems}
            dragOverlay={
              <PlannerDragOverlay
                activeDragId={dnd.activeDragId}
                detail={detail}
                pointPoolItems={trip.pointPoolItems}
                getPointPreview={trip.getPointPreview}
                locale={locale}
              />
            }
            dnd={dnd}
            legsByDay={legsByDay}
            legsFailedByDay={failedDayIds}
            onRetryLegs={retryDay}
            trip={trip}
            dialogs={dialogs}
            canStart={canStart}
            startLabel={startLabel}
            needsDayPick={isDateless || !selectedDay}
            onOpenDayPicker={() => setStartDayPickerOpen(true)}
            onStartImmersive={() => void handleStartImmersive()}
            onOpenItemDetail={handleOpenItemDetail}
            onMoveItem={handleMoveItem}
            onEditNote={handleEditNote}
            weatherByDate={weatherByDate}
            locale={locale}
          />
        )}

        <StartDayPickerSheet
          open={startDayPickerOpen}
          days={detail.days}
          items={detail.items}
          onPick={handlePickStartDay}
          onClose={() => setStartDayPickerOpen(false)}
          locale={locale}
        />

        {dialogs.host}

        {trip.toast ? (
          <div className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] left-1/2 z-[110] min-[769px]:bottom-6 -translate-x-1/2 rounded-2xl bg-slate-900/92 px-4 py-2.5 text-sm font-medium text-white shadow-[0_18px_36px_-20px_rgba(15,23,42,0.6)]">
            {trip.toast}
          </div>
        ) : null}
      </div>
    </div>
  )
}
