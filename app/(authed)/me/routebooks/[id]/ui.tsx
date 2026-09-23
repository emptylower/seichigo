'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronRight, Navigation, Pencil, Plus, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { tr } from '../i18n'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { useTripData } from './hooks/useTripData'
import { useTripDnd } from './hooks/useTripDnd'
import { useDayLegs } from './hooks/useDayLegs'
import { ITEM_DND_PREFIX, MARKER_DND_PREFIX, POOL_DND_PREFIX } from './types'
import type { ItemRecord, PlaceRecord, PointPreview } from './types'
import { dayLabel, itemDisplayTitle, parseDragRecordId, sequenceForImmersive } from './utils'
import { RouteBookPlannerHeader } from './components/RouteBookPlannerHeader'
import { PlannerMapStage } from './components/PlannerMapStage'
import { PlannerPointPoolDragOverlay, PlannerPointPoolPanel } from './components/PlannerPointPoolPanel'
import { DayPlanSidebar } from './components/DayPlanSidebar'
import { DayBlock } from './components/DayBlock'
import { PointDetailCard } from './components/PointDetailCard'
import { RouteBookImmersiveMode } from './components/RouteBookImmersiveMode'
import { MobilePointPoolSheet } from './components/MobilePointPoolSheet'
import { StartDayPickerSheet } from './components/StartDayPickerSheet'

function RouteBookDetailSkeleton() {
  return (
    <div data-layout-wide="true" className="min-h-dvh bg-[linear-gradient(180deg,#fffafc_0%,#fff5f9_100%)]">
      <div className="mx-auto max-w-[1920px] space-y-5 px-4 py-5 sm:px-6">
        <div className="h-5 w-48 animate-pulse rounded-full bg-pink-100/70" />
        <section className="hidden gap-5 lg:grid lg:grid-cols-[420px_minmax(0,1fr)_420px]">
          <div className="h-[74vh] animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
          <div className="h-[74vh] animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
          <div className="h-[74vh] animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
        </section>
        <section className="space-y-4 lg:hidden">
          <div className="h-12 animate-pulse rounded-[24px] bg-pink-100/70" />
          <div className="h-80 animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
          <div className="h-64 animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
        </section>
      </div>
    </div>
  )
}

type ImportCounts = {
  days: number
  points: number
  transits: number
  lodgings: number
  degradedToNote: number
}

function parseImportCounts(raw: string | null): ImportCounts | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const row = parsed as Record<string, unknown>
    const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
    return {
      days: num(row.days),
      points: num(row.points),
      transits: num(row.transits),
      lodgings: num(row.lodgings),
      degradedToNote: num(row.degradedToNote),
    }
  } catch {
    return null
  }
}

/** 详情接口的 lang 参数（与 lib/googlePlaces/details.ts 的 PlaceIntroLang 对齐） */
function placeIntroLang(locale: SupportedLocale): 'zh-CN' | 'en' | 'ja' {
  return locale === 'en' ? 'en' : locale === 'ja' ? 'ja' : 'zh-CN'
}

function formatImportSummary(counts: ImportCounts, locale: SupportedLocale): string {
  const base = t('routebook.importSummary', locale)
    .split('{days}')
    .join(String(counts.days))
    .split('{points}')
    .join(String(counts.points))
    .split('{transits}')
    .join(String(counts.transits))
    .split('{lodgings}')
    .join(String(counts.lodgings))
  if (counts.degradedToNote > 0) {
    return base + t('routebook.importDegraded', locale).split('{n}').join(String(counts.degradedToNote))
  }
  return base
}

function ItemDragOverlayCard({
  item,
  preview,
  places,
  locale,
}: {
  item: ItemRecord
  preview: PointPreview | null
  places: PlaceRecord[]
  locale: SupportedLocale
}) {
  return (
    <div className="w-64 rounded-2xl border border-brand-200 bg-white p-3 shadow-[0_24px_36px_-24px_rgba(225,29,72,0.5)]">
      <div className="truncate text-sm font-semibold text-slate-900">{itemDisplayTitle(item, preview, places, locale)}</div>
      {item.timeStart ? (
        <div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
          {item.timeStart}
        </div>
      ) : null}
    </div>
  )
}

export default function RouteBookDetailClient({ id, locale = 'zh' }: { id: string; locale?: SupportedLocale }) {
  const isMobile = useIsMobile()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mobileTab, setMobileTab] = useState<'route' | 'pool'>('route')
  const [showImmersive, setShowImmersive] = useState(false)
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null)
  const [routeVisible, setRouteVisible] = useState(true)
  const [poolSheetOpen, setPoolSheetOpen] = useState(false)
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
  const { legsByDay, staleDayIds, failedDayIds, retryDay } = useDayLegs(id, detail, selectedDayId, routeVisible)
  const dnd = useTripDnd({
    items: detail?.items ?? [],
    pointPoolItems: trip.pointPoolItems,
    reorder: trip.reorder,
    addItem: trip.addItem,
    onLimitBlocked: () => trip.showToast(tr('routebook.detail.dayLimitToast', locale)),
  })

  // 初始进入为「全部」模式：selectedDayId 保持 null，由用户点击某天进入单天视图。
  // 仅在已选天被删除等场景下回退到 null。
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

  const nextDayFirstTitle = useMemo(() => {
    if (!detail || !selectedDay) return null
    const nextDay = days.find((day) => day.dayIndex > selectedDay.dayIndex)
    if (!nextDay) return null
    const first = sequenceForImmersive(detail.items, nextDay.id)[0]
    if (!first) return null
    if (first.kind === 'place') {
      return detail.places.find((place) => place.id === first.placeId)?.title ?? first.title ?? null
    }
    return first.pointId ? trip.getPointPreview(first.pointId).title : first.title ?? null
  }, [detail, days, selectedDay, trip])

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

  // 无日期行程：点「开始」先弹选天 sheet，选中后再进沉浸模式；
  // 全部模式（未选天）也走同一弹层，由用户挑天开始
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

  const dragOverlay = useMemo(() => {
    if (!dnd.activeDragId || !detail) return null
    const itemId =
      parseDragRecordId(dnd.activeDragId, ITEM_DND_PREFIX) ?? parseDragRecordId(dnd.activeDragId, MARKER_DND_PREFIX)
    if (itemId) {
      const item = detail.items.find((row) => row.id === itemId)
      if (!item) return null
      return (
        <ItemDragOverlayCard
          item={item}
          preview={item.pointId ? trip.getPointPreview(item.pointId) : null}
          places={detail.places}
          locale={locale}
        />
      )
    }
    const poolId = parseDragRecordId(dnd.activeDragId, POOL_DND_PREFIX)
    if (poolId) {
      const poolItem = trip.pointPoolItems.find((row) => row.id === poolId)
      if (!poolItem) return null
      return <PlannerPointPoolDragOverlay preview={trip.getPointPreview(poolItem.pointId)} locale={locale} />
    }
    return null
  }, [dnd.activeDragId, detail, trip, locale])

  if (trip.loading) return <RouteBookDetailSkeleton />
  if (trip.error) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-rose-50 p-4 text-rose-700">{trip.error}</div>
        <a href="/me/routebooks" className="text-sm text-brand-600 hover:underline">
          {tr('routebook.detail.backToList', locale)}
        </a>
      </div>
    )
  }
  if (!detail) return null

  const handleSelectDay = (dayId: string) => {
    setSelectedDayId((prev) => (prev === dayId ? null : dayId))
  }

  const sidebar = (
    <DayPlanSidebar
      detail={detail}
      selectedDayId={selectedDayId}
      onSelectDay={handleSelectDay}
      onShowAll={() => setSelectedDayId(null)}
      getPointPreview={trip.getPointPreview}
      legsByDay={legsByDay}
      routeVisible={routeVisible}
      onToggleRoute={() => setRouteVisible((prev) => !prev)}
      onOptimize={(dayId) => void trip.optimizeDay(dayId)}
      onUndo={() => void trip.undo()}
      undoLabel={trip.undoLabel}
      onAddItem={(dayId, input, index) => void trip.addItem(dayId, input, index)}
      onUpdateItem={(itemId, data) => void trip.updateItem(itemId, data)}
      onDeleteItem={(itemId) => void trip.deleteItem(itemId)}
      onReorder={(dayId, ids) => void trip.reorder(dayId, ids)}
      onUpdateDay={(dayId, data) => void trip.updateDay(dayId, data)}
      onInsertDay={(after) => void trip.insertDay(after)}
      onDeleteDay={(dayId) => void trip.deleteDay(dayId)}
      onOpenItemDetail={handleOpenItemDetail}
      limitBlockedDayId={dnd.limitBlockedDayId}
      legsFailedByDay={failedDayIds}
      onRetryLegs={retryDay}
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
      onClose={handleCloseItemDetail}
      onDelete={() => {
        void trip.deleteItem(selectedItem.id)
        setSelectedItemId(null)
      }}
      onMoveItem={(targetDayId) => {
        handleMoveItem(selectedItem.id, targetDayId)
        setSelectedItemId(null)
      }}
    />
  ) : null

  const mapStage = (
    <PlannerMapStage
      detail={detail}
      selectedDayId={selectedDayId}
      getPointPreview={trip.getPointPreview}
      legsByDay={legsByDay}
      legsStale={selectedDayId ? Boolean(staleDayIds[selectedDayId]) : false}
      legsFailed={selectedDayId ? Boolean(failedDayIds[selectedDayId]) : false}
      routeVisible={routeVisible}
      compact={isMobile}
      startLabel={startLabel}
      startDisabled={!canStart}
      onStartImmersive={() => void handleStartImmersive()}
      activePointId={focusItemId}
      onPointSelect={handleSelectItem}
      detailCard={detailCard}
      locale={locale}
    />
  )

  const poolPanel = (
    <PlannerPointPoolPanel
      detail={detail}
      pointPoolItems={trip.pointPoolItems}
      selectedDayId={selectedDayId}
      getPointPreview={trip.getPointPreview}
      onAddItem={(dayId, input) => void trip.addItem(dayId, input)}
      onReorder={(dayId, ids) => void trip.reorder(dayId, ids)}
      onFocusPoint={handleFocusPoint}
      onRemoveFromPool={(pointId) => void trip.removeFromPool(pointId)}
      compact={isMobile}
      enableDrag={!isMobile}
      locale={locale}
    />
  )

  return (
    <div data-layout-wide="true" className="min-h-[70dvh] bg-[linear-gradient(180deg,#fffafc_0%,#fff5f9_100%)]">
      <nav
        aria-label={tr('routebook.detail.breadcrumbAria', locale)}
        className="border-b border-pink-100/70 bg-white/70 px-4 py-2.5 backdrop-blur-md sm:px-6"
      >
        <div className="mx-auto flex max-w-[1920px] items-center gap-1.5 text-sm text-slate-500">
          <Link href="/me/routebooks" prefetch={false} className="font-medium text-slate-600 no-underline transition hover:text-brand-600">
            {tr('routebook.detail.breadcrumbHome', locale)}
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
          {trip.editingTitle ? (
            <input
              autoFocus
              value={trip.titleDraft}
              onChange={(event) => trip.setTitleDraft(event.target.value)}
              onBlur={() => void trip.handleTitleSave()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                if (event.key === 'Escape') {
                  trip.setTitleDraft(detail.title)
                  trip.setEditingTitle(false)
                }
              }}
              aria-label={tr('routebook.detail.renameLabel', locale)}
              className="min-w-0 flex-1 rounded-lg border border-brand-200 bg-white px-2 py-1 text-sm font-semibold text-slate-900 outline-none focus:border-brand-400 sm:max-w-md"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                trip.setTitleDraft(detail.title)
                trip.setEditingTitle(true)
              }}
              title={tr('routebook.detail.renameHint', locale)}
              className="group inline-flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left font-semibold text-slate-900 transition hover:bg-pink-50"
            >
              <span className="truncate">《{detail.title}》</span>
              <Pencil className="h-3 w-3 shrink-0 text-slate-300 transition group-hover:text-brand-500" />
            </button>
          )}
        </div>
      </nav>

      <div className="mx-auto max-w-[1920px] space-y-5 px-4 py-5 sm:px-6">
        {importSummary ? (
          <div className="flex items-center justify-between gap-3 rounded-[24px] border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-800 shadow-sm">
            <span>{importSummary}</span>
            <button
              type="button"
              aria-label={tr('routebook.detail.closeBanner', locale)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-emerald-600 transition hover:bg-emerald-100"
              onClick={() => setImportSummary(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
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

            <section className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)_420px] lg:min-h-[calc(100dvh-9.5rem)]">
              <div className="flex min-h-0 flex-col gap-4 lg:h-[calc(100dvh-9.5rem)]">
                <RouteBookPlannerHeader routeBookId={detail.id} routeBooks={routeBookSelectorItems} locale={locale} />
                <div className="min-h-0 flex-1">{sidebar}</div>
              </div>
              <div className="min-h-0 lg:h-[calc(100dvh-9.5rem)]">{mapStage}</div>
              <div className="min-h-0 lg:h-[calc(100dvh-9.5rem)]">{poolPanel}</div>
            </section>
          </DndContext>
        ) : (
          <section className="space-y-4">
            <RouteBookPlannerHeader routeBookId={detail.id} routeBooks={routeBookSelectorItems} locale={locale} />

            <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                className={`inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition ${
                  selectedDayId === null
                    ? 'border-brand-500 bg-brand-500 text-white'
                    : 'border-pink-100 bg-white text-slate-600'
                }`}
                onClick={() => setSelectedDayId(null)}
              >
                {tr('routebook.detail.tabAll', locale)}
              </button>
              {days.map((day) => {
                const active = day.id === selectedDayId
                return (
                  <button
                    key={day.id}
                    type="button"
                    className={`inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition ${
                      active ? 'border-brand-500 bg-brand-500 text-white' : 'border-pink-100 bg-white text-slate-600'
                    }`}
                    onClick={() => handleSelectDay(day.id)}
                  >
                    {dayLabel(day, day.dayIndex, locale)}
                  </button>
                )
              })}
            </div>

            <div className="inline-flex w-full rounded-[26px] bg-pink-50/80 p-1">
              {([
                ['route', selectedDay
                  ? tr('routebook.detail.tabRouteDay', locale, { n: selectedDay.dayIndex })
                  : tr('routebook.detail.tabRoute', locale)],
                ['pool', tr('routebook.detail.tabPool', locale)],
              ] as const).map(([key, label]) => {
                const active = mobileTab === key
                return (
                  <button
                    key={key}
                    type="button"
                    className={`inline-flex min-h-12 flex-1 items-center justify-center rounded-[22px] px-3 text-sm font-semibold transition ${
                      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}
                    onClick={() => setMobileTab(key)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {mobileTab === 'route' ? (
              <div className="space-y-4">
                {mapStage}
                {selectedDay ? (
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
                    onToggleRoute={() => setRouteVisible((prev) => !prev)}
                    onOptimize={() => void trip.optimizeDay(selectedDay.id)}
                    onUpdateItem={(itemId, data) => void trip.updateItem(itemId, data)}
                    onDeleteItem={(itemId) => void trip.deleteItem(itemId)}
                    onMoveItem={handleMoveItem}
                    onUpdateDay={(dayId, data) => void trip.updateDay(dayId, data)}
                    onOpenItemDetail={handleOpenItemDetail}
                    expanded
                    onToggleExpanded={() => {}}
                    legsFailed={Boolean(failedDayIds[selectedDay.id])}
                    onRetryLegs={() => retryDay(selectedDay.id)}
                    locale={locale}
                  />
                ) : null}
                <button
                  type="button"
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[24px] border border-brand-200 bg-white text-sm font-semibold text-brand-600 shadow-sm transition hover:bg-brand-50"
                  onClick={() => setPoolSheetOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  {tr('routebook.detail.addFromPool', locale)}
                </button>
              </div>
            ) : (
              poolPanel
            )}
          </section>
        )}

        {isMobile && canStart ? (
          <div className="fixed inset-x-4 bottom-4 z-40">
            <button
              type="button"
              className="inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-[26px] bg-brand-400 px-6 text-lg font-semibold text-white shadow-[0_18px_34px_-22px_rgba(225,29,72,0.7)] transition hover:bg-brand-500"
              onClick={() => {
                void handleStartImmersive()
              }}
            >
              <Navigation className="h-5 w-5" />
              {startLabel}
            </button>
          </div>
        ) : null}

        <MobilePointPoolSheet
          pointPoolItems={sheetPoolItems}
          getPointPreview={trip.getPointPreview}
          onAddToRoute={(pointId) => {
            void trip.addItem(selectedDayId ?? null, { kind: 'point', pointId })
          }}
          isOpen={poolSheetOpen}
          onClose={() => setPoolSheetOpen(false)}
          selectedDayLabel={selectedDay ? `Day ${selectedDay.dayIndex}` : null}
          locale={locale}
        />

        <StartDayPickerSheet
          open={startDayPickerOpen}
          days={detail.days}
          items={detail.items}
          onPick={handlePickStartDay}
          onClose={() => setStartDayPickerOpen(false)}
          locale={locale}
        />

        {trip.toast ? (
          <div className="fixed bottom-6 left-1/2 z-[110] -translate-x-1/2 rounded-2xl bg-slate-900/92 px-4 py-2.5 text-sm font-medium text-white shadow-[0_18px_36px_-20px_rgba(15,23,42,0.6)]">
            {trip.toast}
          </div>
        ) : null}
      </div>
    </div>
  )
}
