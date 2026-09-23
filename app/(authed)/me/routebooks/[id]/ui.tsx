'use client'

import { useEffect, useMemo, useState } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Navigation, Plus, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { useTripData } from './hooks/useTripData'
import { useTripDnd } from './hooks/useTripDnd'
import { useDayLegs } from './hooks/useDayLegs'
import { ITEM_DND_PREFIX, MARKER_DND_PREFIX, POOL_DND_PREFIX } from './types'
import type { ItemRecord, PlaceRecord, PointPreview } from './types'
import { dayLabel, itemDisplayTitle, parseDragRecordId, pickTodayDayId, sequenceForImmersive } from './utils'
import { RouteBookPlannerHeader } from './components/RouteBookPlannerHeader'
import { PlannerMapStage } from './components/PlannerMapStage'
import { PlannerPointPoolDragOverlay, PlannerPointPoolPanel } from './components/PlannerPointPoolPanel'
import { DayPlanSidebar } from './components/DayPlanSidebar'
import { DayBlock } from './components/DayBlock'
import { RouteBookImmersiveMode } from './components/RouteBookImmersiveMode'
import { MobilePointPoolSheet } from './components/MobilePointPoolSheet'

function RouteBookDetailSkeleton() {
  return (
    <div data-layout-wide="true" data-layout-immersive="true" className="min-h-dvh bg-[linear-gradient(180deg,#fffafc_0%,#fff5f9_100%)]">
      <section className="border-b border-pink-100/80 bg-white/80 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="mx-auto h-14 max-w-[1920px] animate-pulse rounded-[28px] bg-white/80 shadow-sm" />
      </section>
      <div className="mx-auto max-w-[1920px] space-y-5 px-4 py-5 sm:px-6">
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

function readClientLocale(): SupportedLocale {
  if (typeof document === 'undefined') return 'zh'
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(zh|en|ja)(?:;|$)/)
  return (match?.[1] as SupportedLocale | undefined) ?? 'zh'
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
}: {
  item: ItemRecord
  preview: PointPreview | null
  places: PlaceRecord[]
}) {
  return (
    <div className="w-64 rounded-2xl border border-brand-200 bg-white p-3 shadow-[0_24px_36px_-24px_rgba(225,29,72,0.5)]">
      <div className="truncate text-sm font-semibold text-slate-900">{itemDisplayTitle(item, preview, places)}</div>
      {item.timeStart ? (
        <div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
          {item.timeStart}
        </div>
      ) : null}
    </div>
  )
}

export default function RouteBookDetailClient({ id }: { id: string }) {
  const isMobile = useIsMobile()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mobileTab, setMobileTab] = useState<'route' | 'pool'>('route')
  const [showImmersive, setShowImmersive] = useState(false)
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null)
  const [routeVisible, setRouteVisible] = useState(true)
  const [poolSheetOpen, setPoolSheetOpen] = useState(false)
  const [focusItemId, setFocusItemId] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<string | null>(null)

  // /plan 导入跳转带回的一次性提示条：读出即清参数
  useEffect(() => {
    const counts = parseImportCounts(searchParams.get('imported'))
    if (!counts) return
    setImportSummary(formatImportSummary(counts, readClientLocale()))
    router.replace(`/me/routebooks/${id}`, { scroll: false })
  }, [id, router, searchParams])

  const t = useTripData(id)
  const detail = t.detail
  const { legsByDay } = useDayLegs(id, detail, routeVisible)
  const dnd = useTripDnd({
    items: detail?.items ?? [],
    pointPoolItems: t.pointPoolItems,
    reorder: t.reorder,
    addItem: t.addItem,
  })

  // 选中天初始化与删除后回退（pickTodayDayId：有日期匹配今天，否则第一天）
  useEffect(() => {
    if (!detail) return
    if (selectedDayId && detail.days.some((day) => day.id === selectedDayId)) return
    setSelectedDayId(pickTodayDayId(detail.days, new Date()))
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
    return first.pointId ? t.getPointPreview(first.pointId).title : first.title ?? null
  }, [detail, days, selectedDay, t])

  const routeBookSelectorItems = useMemo(() => {
    if (!detail) return t.routeBooks
    if (t.routeBooks.some((item) => item.id === detail.id)) return t.routeBooks
    return [
      {
        id: detail.id,
        title: detail.title,
        status: detail.status,
        metadata: detail.metadata,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      },
      ...t.routeBooks,
    ]
  }, [detail, t.routeBooks])

  const bookPointIds = useMemo(
    () => new Set((detail?.items ?? []).map((item) => item.pointId).filter((v): v is string => Boolean(v))),
    [detail]
  )

  const sheetPoolItems = useMemo(
    () => t.pointPoolItems.filter((item) => !bookPointIds.has(item.pointId)),
    [t.pointPoolItems, bookPointIds]
  )

  const startLabel = selectedDay ? `开始 Day ${selectedDay.dayIndex}` : '开始导航'

  const handleStartImmersive = async () => {
    if (!detail || !selectedDay || !immersiveSequence.length) return
    if (detail.status === 'draft') {
      await t.patchBook({ status: 'in_progress' })
    }
    setShowImmersive(true)
  }

  const handleFocusPoint = (pointId: string) => {
    if (!detail) return
    const candidates = detail.items.filter((row) => row.kind === 'point' && row.pointId === pointId)
    const onSelected = candidates.find((row) => row.dayId === selectedDayId)
    setFocusItemId((onSelected ?? candidates[0])?.id ?? null)
  }

  const handleMoveItem = (itemId: string, targetDayId: string | null) => {
    if (!detail) return
    const orderedIds = detail.items
      .filter((row) => row.dayId === targetDayId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => row.id)
      .filter((rowId) => rowId !== itemId)
    void t.reorder(targetDayId, [...orderedIds, itemId])
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
          preview={item.pointId ? t.getPointPreview(item.pointId) : null}
          places={detail.places}
        />
      )
    }
    const poolId = parseDragRecordId(dnd.activeDragId, POOL_DND_PREFIX)
    if (poolId) {
      const poolItem = t.pointPoolItems.find((row) => row.id === poolId)
      if (!poolItem) return null
      return <PlannerPointPoolDragOverlay preview={t.getPointPreview(poolItem.pointId)} />
    }
    return null
  }, [dnd.activeDragId, detail, t])

  if (t.loading) return <RouteBookDetailSkeleton />
  if (t.error) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-rose-50 p-4 text-rose-700">{t.error}</div>
        <a href="/me/routebooks" className="text-sm text-brand-600 hover:underline">
          返回地图列表
        </a>
      </div>
    )
  }
  if (!detail) return null

  const sidebar = (
    <DayPlanSidebar
      detail={detail}
      selectedDayId={selectedDayId}
      onSelectDay={setSelectedDayId}
      getPointPreview={t.getPointPreview}
      legsByDay={legsByDay}
      routeVisible={routeVisible}
      onToggleRoute={() => setRouteVisible((prev) => !prev)}
      onOptimize={(dayId) => void t.optimizeDay(dayId)}
      onUndo={() => void t.undo()}
      undoLabel={t.undoLabel}
      onAddItem={(dayId, input, index) => void t.addItem(dayId, input, index)}
      onUpdateItem={(itemId, data) => void t.updateItem(itemId, data)}
      onDeleteItem={(itemId) => void t.deleteItem(itemId)}
      onReorder={(dayId, ids) => void t.reorder(dayId, ids)}
      onUpdateDay={(dayId, data) => void t.updateDay(dayId, data)}
      onInsertDay={(after) => void t.insertDay(after)}
      onDeleteDay={(dayId) => void t.deleteDay(dayId)}
    />
  )

  const mapStage = (
    <PlannerMapStage
      detail={detail}
      selectedDayId={selectedDayId}
      getPointPreview={t.getPointPreview}
      legsByDay={legsByDay}
      routeVisible={routeVisible}
      compact={isMobile}
      startLabel={startLabel}
      startDisabled={!immersiveSequence.length}
      onStartImmersive={() => void handleStartImmersive()}
      activePointId={focusItemId}
    />
  )

  const poolPanel = (
    <PlannerPointPoolPanel
      detail={detail}
      pointPoolItems={t.pointPoolItems}
      selectedDayId={selectedDayId}
      getPointPreview={t.getPointPreview}
      onAddItem={(dayId, input) => void t.addItem(dayId, input)}
      onReorder={(dayId, ids) => void t.reorder(dayId, ids)}
      onFocusPoint={handleFocusPoint}
      onRemoveFromPool={(pointId) => void t.removeFromPool(pointId)}
      compact={isMobile}
      enableDrag={!isMobile}
    />
  )

  return (
    <div data-layout-wide="true" data-layout-immersive="true" className="min-h-dvh bg-[linear-gradient(180deg,#fffafc_0%,#fff5f9_100%)]">
      <section className="border-b border-pink-100/80 bg-white/82 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" prefetch={false} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm no-underline">
              <Image
                src="/brand/app-logo-64.png?v=2"
                alt="SeichiGo"
                width={40}
                height={40}
                className="h-10 w-10 rounded-xl object-cover"
                unoptimized
              />
            </Link>
            <div className="min-w-0">
              <div className="text-lg font-semibold tracking-tight text-slate-900">SeichiGo</div>
              <div className="text-sm text-slate-500">我的地图 · 按天行程</div>
            </div>
          </div>

          <Link
            href="/me/routebooks"
            prefetch={false}
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-pink-100 bg-white/90 px-4 text-sm font-medium text-slate-700 no-underline shadow-sm transition hover:bg-pink-50/70"
          >
            <ArrowLeft className="h-4 w-4" />
            返回我的地图
          </Link>
        </div>
      </section>

      <div className="mx-auto max-w-[1920px] space-y-5 px-4 py-5 sm:px-6">
        {importSummary ? (
          <div className="flex items-center justify-between gap-3 rounded-[24px] border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-800 shadow-sm">
            <span>{importSummary}</span>
            <button
              type="button"
              aria-label="关闭提示"
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
            dayLabel={dayLabel(selectedDay, selectedDay.dayIndex)}
            nextDayFirstTitle={nextDayFirstTitle}
            checkedInPointIds={t.checkedInPointIds}
            getPointPreview={t.getPointPreview}
            onCheckInSuccess={t.markPointCheckedIn}
            onUndoCheckIn={t.unmarkPointCheckedIn}
            onClose={() => setShowImmersive(false)}
          />
        ) : null}

        {!isMobile ? (
          <DndContext
            sensors={dnd.sensors}
            collisionDetection={closestCenter}
            onDragStart={dnd.handleDragStart}
            onDragEnd={(event) => {
              void dnd.handleDragEnd(event)
            }}
            onDragCancel={dnd.handleDragCancel}
          >
            <DragOverlay>{dragOverlay}</DragOverlay>

            <section className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)_420px] lg:min-h-[calc(100dvh-9.5rem)]">
              <div className="flex min-h-0 flex-col gap-4 lg:h-[calc(100dvh-9.5rem)]">
                <RouteBookPlannerHeader routeBookId={detail.id} routeBooks={routeBookSelectorItems} />
                <div className="min-h-0 flex-1">{sidebar}</div>
              </div>
              <div className="min-h-0 lg:h-[calc(100dvh-9.5rem)]">{mapStage}</div>
              <div className="min-h-0 lg:h-[calc(100dvh-9.5rem)]">{poolPanel}</div>
            </section>
          </DndContext>
        ) : (
          <section className="space-y-4">
            <RouteBookPlannerHeader routeBookId={detail.id} routeBooks={routeBookSelectorItems} />

            <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {days.map((day) => {
                const active = day.id === selectedDayId
                return (
                  <button
                    key={day.id}
                    type="button"
                    className={`inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition ${
                      active ? 'border-brand-500 bg-brand-500 text-white' : 'border-pink-100 bg-white text-slate-600'
                    }`}
                    onClick={() => setSelectedDayId(day.id)}
                  >
                    {dayLabel(day, day.dayIndex)}
                  </button>
                )
              })}
            </div>

            <div className="inline-flex w-full rounded-[26px] bg-pink-50/80 p-1">
              {([
                ['route', selectedDay ? `路线 · Day ${selectedDay.dayIndex}` : '路线'],
                ['pool', '点位池'],
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
                    getPointPreview={t.getPointPreview}
                    legs={legsByDay[selectedDay.id]}
                    routeVisible={routeVisible}
                    onToggleRoute={() => setRouteVisible((prev) => !prev)}
                    onOptimize={() => void t.optimizeDay(selectedDay.id)}
                    onUpdateItem={(itemId, data) => void t.updateItem(itemId, data)}
                    onDeleteItem={(itemId) => void t.deleteItem(itemId)}
                    onMoveItem={handleMoveItem}
                    onUpdateDay={(dayId, data) => void t.updateDay(dayId, data)}
                    expanded
                    onToggleExpanded={() => {}}
                  />
                ) : null}
                <button
                  type="button"
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[24px] border border-brand-200 bg-white text-sm font-semibold text-brand-600 shadow-sm transition hover:bg-brand-50"
                  onClick={() => setPoolSheetOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  从点位池添加
                </button>
              </div>
            ) : (
              poolPanel
            )}
          </section>
        )}

        {isMobile && immersiveSequence.length > 0 ? (
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
          getPointPreview={t.getPointPreview}
          onAddToRoute={(pointId) => {
            void t.addItem(selectedDayId ?? null, { kind: 'point', pointId })
          }}
          isOpen={poolSheetOpen}
          onClose={() => setPoolSheetOpen(false)}
          selectedDayLabel={selectedDay ? `Day ${selectedDay.dayIndex}` : null}
        />

        {t.toast ? (
          <div className="fixed bottom-6 left-1/2 z-[110] -translate-x-1/2 rounded-2xl bg-slate-900/92 px-4 py-2.5 text-sm font-medium text-white shadow-[0_18px_36px_-20px_rgba(15,23,42,0.6)]">
            {t.toast}
          </div>
        ) : null}
      </div>
    </div>
  )
}
