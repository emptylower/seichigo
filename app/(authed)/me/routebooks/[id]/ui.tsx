'use client'

import { useState } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import CheckInModal from '@/components/checkin/CheckInModal'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { SORTED_LIMIT } from './types'
import { useRouteBookDetail } from './hooks/useRouteBookDetail'
import { RouteBookHeader } from './components/RouteBookHeader'
import { RouteListPanel } from './components/RouteListPanel'
import { RouteSidebar } from './components/RouteSidebar'
import { CollapsiblePointPool } from './components/CollapsiblePointPool'
import { MobilePointPoolSheet } from './components/MobilePointPoolSheet'
import TransitGuidance from './components/TransitGuidance'

function RouteBookDetailSkeleton() {
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[30px] border border-pink-100/90 bg-white/90 p-5 shadow-sm sm:p-6">
        <div className="space-y-4">
          <div className="h-8 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
          <div className="flex flex-wrap gap-2">
            <div className="h-10 w-28 animate-pulse rounded-full bg-slate-100" />
            <div className="h-10 w-40 animate-pulse rounded-full bg-slate-100" />
          </div>
        </div>
      </section>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.95fr)]">
        <div className="h-[56vh] min-h-[520px] animate-pulse rounded-3xl border border-slate-200 bg-white" />
        <div className="h-[56vh] min-h-[520px] animate-pulse rounded-3xl border border-slate-200 bg-white" />
      </section>
      <section className="h-48 animate-pulse rounded-3xl border border-slate-200 bg-white" />
    </div>
  )
}

export default function RouteBookDetailClient({ id }: { id: string }) {
  const isMobile = useIsMobile()
  const [poolExpanded, setPoolExpanded] = useState(false)
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false)

  const h = useRouteBookDetail(id)

  if (h.loading) return <RouteBookDetailSkeleton />
  if (h.error) return (
    <div className="space-y-4">
      <div className="rounded-md bg-rose-50 p-3 text-rose-700">{h.error}</div>
      <a href="/me/routebooks" className="text-sm text-brand-600 hover:underline">返回地图列表</a>
    </div>
  )
  if (!h.routeBook) return null

  const transitStops = h.sorted.map((point) => {
    const preview = h.getPointPreview(point.pointId)
    return { lat: preview.geo?.[0] ?? 0, lng: preview.geo?.[1] ?? 0, title: preview.title }
  })

  return (
    <div className="space-y-6">
      <RouteBookHeader
        routeBook={h.routeBook}
        editingTitle={h.editingTitle}
        titleDraft={h.titleDraft}
        setTitleDraft={h.setTitleDraft}
        setEditingTitle={h.setEditingTitle}
        onTitleSave={h.handleTitleSave}
        onStatusChange={h.handleStatusChange}
        travelMode={h.travelMode}
        routeGoogleUrl={h.routeGoogleUrl}
        sortedCount={h.sorted.length}
      />

      {h.checkInTarget && (
        <CheckInModal
          pointId={h.checkInTarget}
          pointName={h.getPointPreview(h.checkInTarget).title}
          onSuccess={h.handleCheckInSuccess}
          onClose={() => h.setCheckInTarget(null)}
        />
      )}

      <DndContext
        sensors={h.sensors}
        collisionDetection={closestCenter}
        onDragStart={(event) => h.setActiveDragId(event.active.id as string)}
        onDragEnd={(event) => {
          h.setActiveDragId(null)
          void h.handleDragEnd(event)
        }}
      >
        <DragOverlay>
          {h.activeDragId ? h.renderDragOverlay(h.activeDragId) : null}
        </DragOverlay>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">路线排序 ({h.sorted.length}/{SORTED_LIMIT})</h2>
            <span className="text-xs text-slate-500">按住卡片拖动排序；可直接把全局点位拖入路线</span>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.95fr)]">
            <RouteListPanel
              sorted={h.sorted}
              getPointPreview={h.getPointPreview}
              onRemove={h.handleRemovePoint}
              canAddToSorted={h.canAddToSorted}
            />
            <RouteSidebar
              previewEmbedUrl={h.previewEmbedUrl}
              focusPointEmbedUrl={h.focusPointEmbedUrl}
              focusPoint={h.focusPoint}
              focusPreview={h.focusPreview}
              routeBook={h.routeBook}
              sorted={h.sorted}
              checkedInPointIds={h.checkedInPointIds}
              travelMode={h.travelMode}
              setTravelMode={h.setTravelMode}
              routeGoogleUrl={h.routeGoogleUrl}
              onCheckIn={(pointId) => h.setCheckInTarget(pointId)}
              onStatusChange={h.handleStatusChange}
              getPointPreview={h.getPointPreview}
              hasRouteStops={h.hasRouteStops}
              effectiveRouteEmbedUrl={h.effectiveRouteEmbedUrl}
              checkedCount={h.checkedCount}
              allDone={h.allDone}
              nextPoint={h.nextPoint}
              nextPointNavUrl={h.nextPointNavUrl}
            >
              <TransitGuidance
                routeBookId={id}
                sortedStops={transitStops}
                travelMode={h.travelMode}
                visible={h.hasRouteStops && h.travelMode === 'transit'}
              />
            </RouteSidebar>
          </div>
        </section>

        {isMobile ? (
          <MobilePointPoolSheet
            pointPoolItems={h.pointPoolItems}
            getPointPreview={h.getPointPreview}
            onAddToRoute={h.handleAddFromPointPool}
            isOpen={mobileSheetOpen}
            onClose={() => setMobileSheetOpen(false)}
          />
        ) : (
          <CollapsiblePointPool
            pointPoolItems={h.pointPoolItems}
            getPointPreview={h.getPointPreview}
            onAddToRoute={h.handleAddFromPointPool}
            isExpanded={poolExpanded}
            onToggle={() => setPoolExpanded(!poolExpanded)}
          />
        )}
      </DndContext>

      {isMobile && !mobileSheetOpen && h.pointPoolItems.length > 0 && (
        <button
          type="button"
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg hover:bg-brand-600"
          onClick={() => setMobileSheetOpen(true)}
        >
          <span className="text-xl">+</span>
        </button>
      )}

      {!h.canAddToSorted && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
          已排序路线已达上限 ({SORTED_LIMIT} 个点位)。如需添加新点位，请先移出部分已有点位。
        </div>
      )}
    </div>
  )
}
