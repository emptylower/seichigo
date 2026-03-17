'use client'

import { useMemo, useState } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Navigation } from 'lucide-react'
import CheckInModal from '@/components/checkin/CheckInModal'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { useRouteBookDetail } from './hooks/useRouteBookDetail'
import { POOL_DND_PREFIX, SORTED_DND_PREFIX } from './types'
import { parseDragRecordId, poolDragId } from './utils'
import { RouteBookPlannerHeader } from './components/RouteBookPlannerHeader'
import { PlannerMapStage } from './components/PlannerMapStage'
import { PlannerPointPoolDragOverlay, PlannerPointPoolPanel, type PlannerPoolItem } from './components/PlannerPointPoolPanel'
import { PlannerRouteDragOverlay, PlannerRoutePanel } from './components/PlannerRoutePanel'
import { RouteBookImmersiveMode } from './components/RouteBookImmersiveMode'

function RouteBookDetailSkeleton() {
  return (
    <div data-layout-wide="true" data-layout-immersive="true" className="min-h-dvh bg-[linear-gradient(180deg,#fffafc_0%,#fff5f9_100%)]">
      <section className="border-b border-pink-100/80 bg-white/80 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="mx-auto h-14 max-w-[1920px] animate-pulse rounded-[28px] bg-white/80 shadow-sm" />
      </section>
      <div className="mx-auto max-w-[1920px] space-y-5 px-4 py-5 sm:px-6">
        <section className="h-36 animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
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

export default function RouteBookDetailClient({ id }: { id: string }) {
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<'route' | 'pool'>('route')
  const [showImmersive, setShowImmersive] = useState(false)

  const h = useRouteBookDetail(id)

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

    return poolItems
  }, [h, selectedPointIds])

  const primaryActionLabel = useMemo(() => {
    if (!h.sorted.length) return '先加入点位'
    return `开始导航 · ${h.sorted.length} 个点位`
  }, [h.sorted.length])

  const handlePrimaryAction = async () => {
    if (!h.sorted.length || !h.routeBook) return
    if (h.routeBook.status === 'draft') {
      await h.handleStatusChange('in_progress')
    }
    setShowImmersive(true)
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
      focusPreview={h.focusPreview}
      nextPoint={h.nextPoint}
      nextPreview={h.nextPoint ? h.getPointPreview(h.nextPoint.pointId) : null}
      onCheckIn={(pointId) => h.setCheckInTarget(pointId)}
      onMarkComplete={() => void h.handleStatusChange('completed')}
      onPrimaryAction={() => {
        void handlePrimaryAction()
      }}
      primaryActionLabel={primaryActionLabel}
      primaryActionDisabled={!h.sorted.length}
      compact={isMobile}
    />
  )

  const routePanel = (
    <PlannerRoutePanel
      sorted={h.sorted}
      getPointPreview={h.getPointPreview}
      onRemove={h.handleRemovePoint}
      enableDrag={!isMobile}
    />
  )

  const poolPanel = (
    <PlannerPointPoolPanel
      items={plannerPoolItems}
      selectedCount={h.routeBook.points.length}
      totalCount={plannerPoolItems.length + h.routeBook.points.length}
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
                src="/brand/app-logo.png"
                alt="SeichiGo"
                width={40}
                height={40}
                className="h-10 w-10 rounded-xl object-cover"
              />
            </Link>
            <div className="min-w-0">
              <div className="text-lg font-semibold tracking-tight text-slate-900">SeichiGo</div>
              <div className="text-sm text-slate-500">我的地图 · 路线规划</div>
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
        {showImmersive && h.routeBook ? (
          <RouteBookImmersiveMode
            routeBookTitle={h.routeBook.title}
            sorted={h.sorted}
            checkedInPointIds={h.checkedInPointIds}
            getPointPreview={h.getPointPreview}
            onCheckInSuccess={h.handleCheckInSuccess}
            onClose={() => setShowImmersive(false)}
          />
        ) : null}
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

            <section className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)_420px] lg:min-h-[calc(100dvh-9.5rem)]">
              <div className="flex min-h-0 flex-col gap-4 lg:h-[calc(100dvh-9.5rem)]">
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
                <div className="min-h-0 flex-1">{routePanel}</div>
              </div>
              <div className="min-h-0 lg:h-[calc(100dvh-9.5rem)]">{mapStage}</div>
              <div className="min-h-0 lg:h-[calc(100dvh-9.5rem)]">{poolPanel}</div>
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
      </div>
    </div>
  )
}
