'use client'

import { useMemo, useState } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import Link from 'next/link'
import { ArrowLeft, MapPinned, Navigation } from 'lucide-react'
import CheckInModal from '@/components/checkin/CheckInModal'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { useRouteBookDetail } from './hooks/useRouteBookDetail'
import { POOL_DND_PREFIX, SORTED_DND_PREFIX } from './types'
import { parseDragRecordId, poolDragId } from './utils'
import { RouteBookPlannerHeader } from './components/RouteBookPlannerHeader'
import { PlannerMapStage } from './components/PlannerMapStage'
import { PlannerPointPoolDragOverlay, PlannerPointPoolPanel, type PlannerPoolItem } from './components/PlannerPointPoolPanel'
import { PlannerRouteDragOverlay, PlannerRoutePanel } from './components/PlannerRoutePanel'

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
    return `开始导航 · ${h.sorted.length} 个点位`
  }, [h.sorted.length])

  const handlePrimaryAction = async () => {
    if (!h.sorted.length || !h.routeBook || !h.googleNavUrl) return
    if (h.routeBook.status === 'draft') {
      await h.handleStatusChange('in_progress')
    }
    window.open(h.googleNavUrl, '_blank', 'noopener,noreferrer')
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
      primaryActionDisabled={!h.sorted.length || !h.googleNavUrl}
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

  const poolPanel = <PlannerPointPoolPanel items={plannerPoolItems} compact={isMobile} enableDrag={!isMobile} />

  return (
    <div data-layout-wide="true" data-layout-immersive="true" className="min-h-dvh bg-[linear-gradient(180deg,#fffafc_0%,#fff5f9_100%)]">
      <section className="border-b border-pink-100/80 bg-white/82 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-[1920px] items-center gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pink-50 text-brand-600">
              <MapPinned className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <div className="text-[28px] font-bold tracking-tight text-slate-900">圣地巡礼</div>
              <div className="text-sm text-slate-500">我的朝圣之旅</div>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1920px] space-y-5 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/me/routebooks"
            prefetch={false}
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-pink-100 bg-white/85 px-4 text-sm font-medium text-slate-700 no-underline shadow-sm transition hover:bg-pink-50/70"
          >
            <ArrowLeft className="h-4 w-4" />
            返回我的地图
          </Link>
          <span className="inline-flex rounded-full border border-slate-200 bg-white/85 px-4 py-2 text-sm font-medium text-slate-500 shadow-sm">
            当前地图共 {h.sorted.length} 个点位
          </span>
        </div>

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

            <section className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)_420px]">
              <div className="min-h-0 lg:h-[calc(100dvh-15rem)]">{routePanel}</div>
              <div className="min-h-0 lg:h-[calc(100dvh-15rem)]">{mapStage}</div>
              <div className="min-h-0 lg:h-[calc(100dvh-15rem)]">{poolPanel}</div>
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
      </div>
    </div>
  )
}
