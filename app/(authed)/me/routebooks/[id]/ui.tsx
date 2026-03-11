'use client'

import { useMemo, useState } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import { Navigation } from 'lucide-react'
import CheckInModal from '@/components/checkin/CheckInModal'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { useRouteBookDetail } from './hooks/useRouteBookDetail'
import { POOL_DND_PREFIX, SORTED_DND_PREFIX } from './types'
import { parseDragRecordId, poolDragId } from './utils'
import TransitGuidance from './components/TransitGuidance'
import { RouteBookImmersiveMode } from './components/RouteBookImmersiveMode'
import { RouteBookPlannerHeader } from './components/RouteBookPlannerHeader'
import { PlannerMapStage } from './components/PlannerMapStage'
import { PlannerPointPoolDragOverlay, PlannerPointPoolPanel, type PlannerPoolItem } from './components/PlannerPointPoolPanel'
import { PlannerRouteDragOverlay, PlannerRoutePanel } from './components/PlannerRoutePanel'

function RouteBookDetailSkeleton() {
  return (
    <div className="space-y-5">
      <section className="h-56 animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
      <section className="hidden gap-4 xl:grid xl:grid-cols-[340px_minmax(0,1fr)_320px]">
        <div className="h-[70vh] animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
        <div className="h-[70vh] animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
        <div className="h-[70vh] animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
      </section>
      <section className="space-y-4 xl:hidden">
        <div className="h-12 animate-pulse rounded-[24px] bg-pink-100/70" />
        <div className="h-80 animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
        <div className="h-64 animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
      </section>
    </div>
  )
}

export default function RouteBookDetailClient({ id }: { id: string }) {
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<'route' | 'pool'>('route')
  const [immersiveOpen, setImmersiveOpen] = useState(false)

  const h = useRouteBookDetail(id)

  const nextTransitStop = h.nextPoint
    ? (() => {
        const preview = h.getPointPreview(h.nextPoint.pointId)
        if (!preview.geo) return null
        return { lat: preview.geo[0], lng: preview.geo[1], title: preview.title }
      })()
    : null

  const selectedPointIds = useMemo(() => new Set((h.routeBook?.points || []).map((point) => point.pointId)), [h.routeBook])
  const routeBookSelectorItems = useMemo(() => {
    if (!h.routeBook) return h.routeBooks
    if (h.routeBooks.some((item) => item.id === h.routeBook?.id)) return h.routeBooks
    return [
      {
        id: h.routeBook.id,
        title: h.routeBook.title,
        status: h.routeBook.status,
        metadata: h.routeBook.metadata,
        createdAt: h.routeBook.createdAt,
        updatedAt: h.routeBook.updatedAt,
      },
      ...h.routeBooks,
    ]
  }, [h.routeBook, h.routeBooks])

  const plannerPoolItems = useMemo<PlannerPoolItem[]>(() => {
    if (!h.routeBook) return []

    const selectedItems = h.routeBook.points.map((point, index) => ({
      id: `selected:${point.id}:${index}`,
      pointId: point.pointId,
      preview: h.getPointPreview(point.pointId),
      selected: true,
    }))

    const poolItems = h.pointPoolItems
      .filter((item) => !selectedPointIds.has(item.pointId))
      .map((item) => ({
        id: item.id,
        pointId: item.pointId,
        preview: h.getPointPreview(item.pointId),
        selected: false,
        dragId: poolDragId(item.id),
        onAdd: () => {
          void h.handleAddFromPointPool(item.pointId)
        },
      }))

    return [...selectedItems, ...poolItems]
  }, [h, selectedPointIds])

  const primaryActionLabel = useMemo(() => {
    if (!h.sorted.length) return '先加入点位'
    if (h.routeBook?.status === 'draft') return `开始巡礼 · ${h.sorted.length} 个点位`
    if (h.routeBook?.status === 'in_progress') return `继续巡礼 · ${h.sorted.length} 个点位`
    return `回顾路线 · ${h.sorted.length} 个点位`
  }, [h.routeBook?.status, h.sorted.length])

  const handlePrimaryAction = async () => {
    if (!h.sorted.length || !h.routeBook) return
    if (h.routeBook.status === 'draft') {
      await h.handleStatusChange('in_progress')
    }
    setImmersiveOpen(true)
  }

  const dragOverlay = useMemo(() => {
    if (!h.activeDragId) return null

    const sortedRecordId = parseDragRecordId(h.activeDragId, SORTED_DND_PREFIX)
    if (sortedRecordId) {
      const point = h.sorted.find((row) => row.id === sortedRecordId)
      if (!point) return null
      return <PlannerRouteDragOverlay point={point} preview={h.getPointPreview(point.pointId)} />
    }

    const poolRecordId = parseDragRecordId(h.activeDragId, POOL_DND_PREFIX)
    if (poolRecordId) {
      const item = plannerPoolItems.find((row) => row.id === poolRecordId)
      if (!item) return null
      return <PlannerPointPoolDragOverlay item={item} />
    }

    return null
  }, [h.activeDragId, h.getPointPreview, h.sorted, plannerPoolItems])

  if (h.loading) return <RouteBookDetailSkeleton />
  if (h.error) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-rose-50 p-4 text-rose-700">{h.error}</div>
        <a href="/me/routebooks" className="text-sm text-brand-600 hover:underline">
          返回地图列表
        </a>
      </div>
    )
  }
  if (!h.routeBook) return null

  const mapStage = (
    <PlannerMapStage
      status={h.routeBook.status}
      sortedCount={h.sorted.length}
      checkedCount={h.checkedCount}
      allDone={h.allDone}
      previewEmbedUrl={h.previewEmbedUrl}
      hasRouteStops={h.hasRouteStops}
      travelMode={h.travelMode}
      setTravelMode={h.setTravelMode}
      focusPreview={h.focusPreview}
      nextPoint={h.nextPoint}
      nextPreview={h.nextPoint ? h.getPointPreview(h.nextPoint.pointId) : null}
      googleNavUrl={h.googleNavUrl}
      onCheckIn={(pointId) => h.setCheckInTarget(pointId)}
      onMarkComplete={() => void h.handleStatusChange('completed')}
      onPrimaryAction={() => {
        void handlePrimaryAction()
      }}
      primaryActionLabel={primaryActionLabel}
      primaryActionDisabled={!h.sorted.length}
      compact={isMobile}
    >
      <TransitGuidance
        routeBookId={id}
        nextStop={nextTransitStop}
        travelMode={h.travelMode}
        visible={Boolean(nextTransitStop) && h.travelMode === 'transit'}
      />
    </PlannerMapStage>
  )

  const routePanel = (
    <PlannerRoutePanel
      sorted={h.sorted}
      getPointPreview={h.getPointPreview}
      onRemove={h.handleRemovePoint}
      enableDrag={!isMobile}
    />
  )

  const poolPanel = <PlannerPointPoolPanel items={plannerPoolItems} compact={isMobile} enableDrag={!isMobile} />

  return (
    <div className="space-y-5 pb-24 md:pb-10">
      <RouteBookPlannerHeader
        routeBook={h.routeBook}
        routeBooks={routeBookSelectorItems}
        sortedCount={h.sorted.length}
        checkedCount={h.checkedCount}
        editingTitle={h.editingTitle}
        titleDraft={h.titleDraft}
        setTitleDraft={h.setTitleDraft}
        setEditingTitle={h.setEditingTitle}
        onTitleSave={h.handleTitleSave}
        onStatusChange={h.handleStatusChange}
      />

      {h.checkInTarget ? (
        <CheckInModal
          pointId={h.checkInTarget}
          pointName={h.getPointPreview(h.checkInTarget).title}
          onSuccess={h.handleCheckInSuccess}
          onClose={() => h.setCheckInTarget(null)}
        />
      ) : null}

      {!isMobile ? (
        <DndContext
          sensors={h.sensors}
          collisionDetection={closestCenter}
          onDragStart={(event) => h.setActiveDragId(String(event.active.id))}
          onDragEnd={(event) => {
            h.setActiveDragId(null)
            void h.handleDragEnd(event)
          }}
          onDragCancel={() => h.setActiveDragId(null)}
        >
          <DragOverlay>{dragOverlay}</DragOverlay>

          <section className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_320px]">
            <div className="min-h-0">{routePanel}</div>
            <div className="min-h-0">{mapStage}</div>
            <div className="min-h-0">{poolPanel}</div>
          </section>
        </DndContext>
      ) : (
        <section className="space-y-4">
          <div className="inline-flex w-full rounded-[26px] bg-pink-50/80 p-1">
            {([
              ['route', `路线 (${h.sorted.length})`],
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
              {routePanel}
            </div>
          ) : (
            poolPanel
          )}
        </section>
      )}

      {isMobile && h.sorted.length > 0 ? (
        <div className="fixed inset-x-4 bottom-4 z-40">
          <button
            type="button"
            className="inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-[26px] bg-brand-400 px-6 text-lg font-semibold text-white shadow-[0_18px_34px_-22px_rgba(225,29,72,0.7)] transition hover:bg-brand-500"
            onClick={() => {
              void handlePrimaryAction()
            }}
          >
            <Navigation className="h-5 w-5" />
            {primaryActionLabel}
          </button>
        </div>
      ) : null}

      {immersiveOpen ? (
        <RouteBookImmersiveMode
          routeBookTitle={h.routeBook.title}
          sorted={h.sorted}
          checkedInPointIds={h.checkedInPointIds}
          getPointPreview={h.getPointPreview}
          onCheckInSuccess={h.markPointCheckedIn}
          onClose={() => setImmersiveOpen(false)}
        />
      ) : null}
    </div>
  )
}
