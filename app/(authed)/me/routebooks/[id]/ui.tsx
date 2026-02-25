'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import CheckInModal from '@/components/checkin/CheckInModal'
import type {
  PointRecord,
  PointPoolItem,
  RouteBookDetail,
  DetailResponse,
  PointPreview,
  BangumiResponse,
  NavMode,
  RouteBookStatus,
  RouteBookZone,
} from './types'
import {
  SORTED_LIMIT,
  SORTED_ZONE_ID,
  UNSORTED_ZONE_ID,
  SORTED_DND_PREFIX,
  UNSORTED_DND_PREFIX,
  POOL_DND_PREFIX,
  NAV_MODE_LABEL,
  NAV_MODE_PARAM,
  PREVIEW_POINT_BATCH_SIZE,
  PREVIEW_FETCH_IDLE_TIMEOUT,
  ROUTE_PREVIEW_URL_SYNC_DEBOUNCE_MS,
  DRAG_SAFE_CONTROL_PROPS,
  POINT_FALLBACK_GRADIENTS,
  STATUS_LABEL,
  STATUS_STYLE,
  STATUS_ACTION_CLASS,
} from './types'
import {
  isPointRecord,
  getSortedPoints,
  getUnsortedPoints,
  rebuildPoints,
  reorderSortedInPoints,
  movePointToZoneInPoints,
  addPointToZoneInPoints,
  formatGoogleStop,
  buildGooglePointEmbedUrl,
  buildGoogleDirectionsUrl,
  buildGoogleDirectionsEmbedUrl,
  buildGoogleLegDirectionsUrl,
  formatDate,
  parseBangumiId,
  parsePointKey,
  buildPointLookupCandidates,
  pickPointGradient,
  buildFallbackPreview,
  isGeoPair,
  sortedDragId,
  unsortedDragId,
  poolDragId,
  parseDragRecordId,
} from './utils'
import {
  PointCard,
  SortablePointCard,
  PointPoolCard,
  DraggableUnsortedPointCard,
  DraggablePointPoolCard,
} from './components/PointCard'
import { RouteSidebar } from './components/RouteSidebar'
import { DroppablePanel } from './components/DroppablePanel'



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
  const [routeBook, setRouteBook] = useState<RouteBookDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [checkedInPointIds, setCheckedInPointIds] = useState<Set<string>>(new Set())
  const [checkInTarget, setCheckInTarget] = useState<string | null>(null)
  const [travelMode, setTravelMode] = useState<NavMode>('transit')
  const [pointPoolItems, setPointPoolItems] = useState<PointPoolItem[]>([])
  const [pointPreviewById, setPointPreviewById] = useState<Record<string, PointPreview>>({})
  const [stableRouteEmbedUrl, setStableRouteEmbedUrl] = useState<string | null>(null)
  const [stableRouteSignature, setStableRouteSignature] = useState('')
  const mapsEmbedApiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY ||
    ''

  const parsePointPoolItems = useCallback((items: unknown): PointPoolItem[] => {
    if (!Array.isArray(items)) return []
    return items.filter((item: unknown): item is PointPoolItem => {
      if (!item || typeof item !== 'object') return false
      const row = item as Record<string, unknown>
      return (
        typeof row.id === 'string' &&
        typeof row.pointId === 'string' &&
        typeof row.createdAt === 'string' &&
        typeof row.updatedAt === 'string'
      )
    })
  }, [])

  const refreshPointPool = useCallback(async () => {
    try {
      const res = await fetch('/api/me/point-pool', { method: 'GET' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.ok) {
        setPointPoolItems(parsePointPoolItems(data.items))
      }
    } catch {
      // ignore background refresh failures
    }
  }, [parsePointPoolItems])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 140, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const hydrateAuxiliaryData = useCallback(async () => {
    const [pointStateRes, pointPoolRes] = await Promise.allSettled([
      fetch('/api/me/point-states?state=checked_in'),
      fetch('/api/me/point-pool'),
    ])

    if (pointStateRes.status === 'fulfilled') {
      const stateData = await pointStateRes.value.json().catch(() => ({}))
      if (pointStateRes.value.ok && stateData?.ok && Array.isArray(stateData.items)) {
        setCheckedInPointIds(new Set(stateData.items.map((item: { pointId: string }) => item.pointId)))
      }
    }

    if (pointPoolRes.status === 'fulfilled') {
      const poolData = await pointPoolRes.value.json().catch(() => ({}))
      if (pointPoolRes.value.ok && poolData?.ok && Array.isArray(poolData.items)) {
        setPointPoolItems(parsePointPoolItems(poolData.items))
      } else {
        setPointPoolItems([])
      }
    }
  }, [parsePointPoolItems])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPointPreviewById({})
    setCheckedInPointIds(new Set())
    setPointPoolItems([])
    setStableRouteEmbedUrl(null)
    setStableRouteSignature('')
    try {
      const rbRes = await fetch(`/api/me/routebooks/${id}`)
      const rbData = (await rbRes.json().catch(() => ({}))) as DetailResponse
      if (!rbRes.ok || 'error' in rbData) {
        setError(('error' in rbData && rbData.error) || '加载失败')
        setLoading(false)
        return
      }

      const detail = rbData.routeBook || rbData.item || null
      if (!detail) {
        setError('地图数据异常，请刷新重试')
        setLoading(false)
        return
      }

      setRouteBook(detail)
      setTitleDraft(detail.title)
      setLoading(false)
      void hydrateAuxiliaryData()
    } catch {
      setError('加载失败')
    }
    setLoading(false)
  }, [hydrateAuxiliaryData, id])

  useEffect(() => {
    void load()
  }, [load])

  const unsorted = routeBook ? getUnsortedPoints(routeBook.points) : []
  const sorted = routeBook ? getSortedPoints(routeBook.points) : []


  const allPointIds = useMemo(() => {
    const pointIds = [
      ...(routeBook?.points.map((point) => point.pointId) ?? []),
      ...pointPoolItems.map((item) => item.pointId),
    ]
    return Array.from(new Set(pointIds))
  }, [routeBook, pointPoolItems])

  const unresolvedPointIds = useMemo(() => {
    return allPointIds.filter((pointId) => !pointPreviewById[pointId])
  }, [allPointIds, pointPreviewById])
  const previewFetchPointIds = useMemo(() => unresolvedPointIds.slice(0, PREVIEW_POINT_BATCH_SIZE), [unresolvedPointIds])

  useEffect(() => {
    if (!previewFetchPointIds.length) return

    const grouped = new Map<number, string[]>()
    const fallbackPreviews: Record<string, PointPreview> = {}

    for (const pointId of previewFetchPointIds) {
      const bangumiId = parseBangumiId(pointId)
      if (!bangumiId) {
        fallbackPreviews[pointId] = buildFallbackPreview(pointId)
        continue
      }
      const list = grouped.get(bangumiId) ?? []
      list.push(pointId)
      grouped.set(bangumiId, list)
    }

    if (Object.keys(fallbackPreviews).length > 0) {
      setPointPreviewById((prev) => ({ ...prev, ...fallbackPreviews }))
    }

    if (!grouped.size) return

    let cancelled = false
    let timeoutId: number | null = null
    let idleId: number | null = null
    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    const run = async () => {
      const loadedPreviews: Record<string, PointPreview> = {}

      await Promise.all(
        Array.from(grouped.entries()).map(async ([bangumiId, ids]) => {
          try {
            const res = await fetch(`/api/anitabi/bangumi/${bangumiId}`)
            if (!res.ok) return
            const data = (await res.json().catch(() => null)) as BangumiResponse | null
            if (!data) return

            const pointMap = new Map<string, { title: string; image: string | null; geo: [number, number] | null }>()
            for (const point of data.points || []) {
              const rawPointId = String(point?.id || '').trim()
              if (!rawPointId) continue
              const title = (point.nameZh || point.name || rawPointId || '').trim()
              if (!title) continue
              const meta = {
                title,
                image: typeof point.image === 'string' ? point.image : null,
                geo: isGeoPair(point.geo) ? ([point.geo[0], point.geo[1]] as [number, number]) : null,
              }
              for (const candidate of buildPointLookupCandidates(rawPointId)) {
                pointMap.set(candidate, meta)
              }
            }

            const subtitle =
              (typeof data.card?.titleZh === 'string' && data.card.titleZh.trim()) ||
              (typeof data.card?.title === 'string' && data.card.title.trim()) ||
              `作品 #${bangumiId}`

            for (const pointId of ids) {
              const matched = buildPointLookupCandidates(pointId)
                .map((candidate) => pointMap.get(candidate))
                .find((entry) => Boolean(entry))
              const key = parsePointKey(pointId)
              loadedPreviews[pointId] = {
                title: matched?.title || `点位 ${key}`,
                subtitle,
                image: matched?.image || null,
                geo: matched?.geo || null,
              }
            }
          } catch {
            for (const pointId of ids) {
              loadedPreviews[pointId] = buildFallbackPreview(pointId)
            }
          }
        })
      )

      if (cancelled) return

      setPointPreviewById((prev) => {
        const next = { ...prev }
        for (const pointId of previewFetchPointIds) {
          next[pointId] = loadedPreviews[pointId] || next[pointId] || buildFallbackPreview(pointId)
        }
        return next
      })
    }

    if (typeof win.requestIdleCallback === 'function' && typeof win.cancelIdleCallback === 'function') {
      idleId = win.requestIdleCallback(() => {
        void run()
      }, { timeout: PREVIEW_FETCH_IDLE_TIMEOUT })
    } else {
      timeoutId = window.setTimeout(() => {
        void run()
      }, 180)
    }

    return () => {
      cancelled = true
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      if (idleId !== null && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleId)
      }
    }
  }, [previewFetchPointIds])

  const getPointPreview = useCallback((pointId: string) => {
    return pointPreviewById[pointId] || buildFallbackPreview(pointId)
  }, [pointPreviewById])

  async function handleTitleSave() {
    const title = titleDraft.trim()
    if (!title || !routeBook || title === routeBook.title) {
      setEditingTitle(false)
      return
    }
    const res = await fetch(`/api/me/routebooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (res.ok) {
      setRouteBook((prev) => prev ? { ...prev, title } : prev)
    }
    setEditingTitle(false)
  }

  async function handleStatusChange(status: RouteBookStatus) {
    if (!routeBook) return
    const res = await fetch(`/api/me/routebooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setRouteBook((prev) => prev ? { ...prev, status } : prev)
    }
  }

  const persistSortedOrder = useCallback(async (pointIds: string[]): Promise<boolean> => {
    const res = await fetch(`/api/me/routebooks/${id}/points`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'reorder', pointIds }),
    })
    if (!res.ok) {
      void load()
      return false
    }
    return true
  }, [id, load])

  async function handleRemovePoint(pointId: string) {
    const res = await fetch(`/api/me/routebooks/${id}/points`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pointId }),
    })
    if (res.ok) {
      setRouteBook((prev) => {
        if (!prev) return prev
        const nextSorted = getSortedPoints(prev.points).filter((point) => point.pointId !== pointId)
        const nextUnsorted = getUnsortedPoints(prev.points).filter((point) => point.pointId !== pointId)
        return { ...prev, points: rebuildPoints(nextSorted, nextUnsorted) }
      })
      void refreshPointPool()
    }
  }

  async function handleMoveToZone(pointId: string, targetZone: RouteBookZone, targetSortedIndex?: number) {
    if (!routeBook) return

    const nextPoints = movePointToZoneInPoints(routeBook.points, pointId, targetZone, targetSortedIndex)
    setRouteBook({ ...routeBook, points: nextPoints })

    const moveRes = await fetch(`/api/me/routebooks/${id}/points`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'move', pointId, zone: targetZone }),
    })
    if (!moveRes.ok) {
      void load()
      return
    }

    if (targetZone === 'sorted') {
      const sortedPointIds = getSortedPoints(nextPoints).map((point) => point.pointId)
      await persistSortedOrder(sortedPointIds)
    }
  }

  async function handleAddFromPointPool(
    pointId: string,
    targetZone: RouteBookZone = 'unsorted',
    targetSortedIndex?: number
  ): Promise<boolean> {
    if (!routeBook) return false

    const res = await fetch(`/api/me/routebooks/${id}/points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pointId, zone: targetZone }),
    })
    if (!res.ok) return false

    const payload = await res.json().catch(() => ({}))
    const created = isPointRecord(payload?.item) ? payload.item : null
    if (!created) {
      void load()
      return false
    }

    const nextPoints = addPointToZoneInPoints(routeBook.points, created, targetZone, targetSortedIndex)
    setRouteBook({ ...routeBook, points: nextPoints })
    setPointPoolItems((prev) => prev.filter((item) => item.pointId !== pointId))

    if (targetZone === 'sorted') {
      const sortedPointIds = getSortedPoints(nextPoints).map((point) => point.pointId)
      await persistSortedOrder(sortedPointIds)
    }

    return true
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || !routeBook) return

    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    const dropSortedIndex = (() => {
      if (overId === SORTED_ZONE_ID) return sorted.length
      const overSortedRecordId = parseDragRecordId(overId, SORTED_DND_PREFIX)
      if (!overSortedRecordId) return sorted.length
      const found = sorted.findIndex((point) => point.id === overSortedRecordId)
      return found >= 0 ? found : sorted.length
    })()

    const activeSortedRecordId = parseDragRecordId(activeId, SORTED_DND_PREFIX)
    if (activeSortedRecordId && (overId === SORTED_ZONE_ID || overId.startsWith(SORTED_DND_PREFIX))) {
      const oldIndex = sorted.findIndex((point) => point.id === activeSortedRecordId)
      const newIndex = overId === SORTED_ZONE_ID
        ? Math.max(sorted.length - 1, 0)
        : sorted.findIndex((point) => sortedDragId(point.id) === overId)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(sorted, oldIndex, newIndex)
      const reorderedPointIds = reordered.map((point) => point.pointId)
      const updatedPoints = reorderSortedInPoints(routeBook.points, reorderedPointIds)
      setRouteBook({ ...routeBook, points: updatedPoints })
      await persistSortedOrder(reorderedPointIds)
      return
    }

    if (activeSortedRecordId && overId === UNSORTED_ZONE_ID) {
      const source = sorted.find((point) => point.id === activeSortedRecordId)
      if (!source) return
      await handleMoveToZone(source.pointId, 'unsorted')
      return
    }

    const activeUnsortedRecordId = parseDragRecordId(activeId, UNSORTED_DND_PREFIX)
    if (activeUnsortedRecordId && (overId === SORTED_ZONE_ID || overId.startsWith(SORTED_DND_PREFIX))) {
      if (!canAddToSorted) return
      const source = unsorted.find((point) => point.id === activeUnsortedRecordId)
      if (!source) return
      await handleMoveToZone(source.pointId, 'sorted', dropSortedIndex)
      return
    }

    const activePoolItemId = parseDragRecordId(activeId, POOL_DND_PREFIX)
    if (activePoolItemId && (overId === SORTED_ZONE_ID || overId.startsWith(SORTED_DND_PREFIX))) {
      if (!canAddToSorted) return
      const source = pointPoolItems.find((item) => item.id === activePoolItemId)
      if (!source) return
      await handleAddFromPointPool(source.pointId, 'sorted', dropSortedIndex)
    }
  }

  const canAddToSorted = sorted.length < SORTED_LIMIT
  const sortedStops = sorted.map((point) => {
    const preview = getPointPreview(point.pointId)
    return {
      point,
      preview,
      stop: formatGoogleStop(point, preview),
    }
  })
  const sortedStopValues = sortedStops.map((row) => row.stop)
  const hasRouteStops = sortedStopValues.length >= 2
  const routeGoogleUrl = buildGoogleDirectionsUrl(sortedStopValues, travelMode)
  const routeEmbedUrl = buildGoogleDirectionsEmbedUrl(sortedStopValues, travelMode, mapsEmbedApiKey)
  const routePreviewSignature = `${travelMode}:${sorted.map((point) => point.id).join('|')}`
  const hasUnresolvedRoutePreviews = sorted.some((point) => !pointPreviewById[point.pointId])

  useEffect(() => {
    if (!hasRouteStops) {
      if (stableRouteEmbedUrl !== null) setStableRouteEmbedUrl(null)
      if (stableRouteSignature !== '') setStableRouteSignature('')
      return
    }

    if (stableRouteSignature !== routePreviewSignature) {
      setStableRouteSignature(routePreviewSignature)
      setStableRouteEmbedUrl(routeEmbedUrl)
      return
    }

    if (stableRouteEmbedUrl === routeEmbedUrl) return

    if (hasUnresolvedRoutePreviews) {
      const timer = window.setTimeout(() => {
        setStableRouteEmbedUrl(routeEmbedUrl)
      }, ROUTE_PREVIEW_URL_SYNC_DEBOUNCE_MS)
      return () => window.clearTimeout(timer)
    }

    setStableRouteEmbedUrl(routeEmbedUrl)
  }, [
    hasRouteStops,
    hasUnresolvedRoutePreviews,
    routeEmbedUrl,
    routePreviewSignature,
    stableRouteEmbedUrl,
    stableRouteSignature,
  ])

  const effectiveRouteEmbedUrl = hasRouteStops ? (stableRouteEmbedUrl ?? routeEmbedUrl) : null
  const routeLegs = sortedStops.slice(0, -1).map((from, index) => {
    const to = sortedStops[index + 1]
    if (!to) return null
    return {
      id: `${from.point.id}:${to.point.id}`,
      order: index + 1,
      from,
      to,
      navUrl: buildGoogleLegDirectionsUrl(from.stop, to.stop, travelMode),
    }
  }).filter((item): item is {
    id: string
    order: number
    from: { point: PointRecord; preview: PointPreview; stop: string }
    to: { point: PointRecord; preview: PointPreview; stop: string }
    navUrl: string
  } => Boolean(item))
  const checkedCount = sorted.filter((p) => checkedInPointIds.has(p.pointId)).length
  const allDone = sorted.length > 0 && checkedCount === sorted.length
  const nextPoint = sorted.find((p) => !checkedInPointIds.has(p.pointId)) || null
  const focusPoint = nextPoint || sorted[0] || null
  const focusPreview = focusPoint ? getPointPreview(focusPoint.pointId) : null
  const focusPointEmbedUrl = buildGooglePointEmbedUrl(focusPreview)
  const previewEmbedUrl = hasRouteStops ? effectiveRouteEmbedUrl : focusPointEmbedUrl
  const nextPointNavUrl = nextPoint
    ? buildGoogleDirectionsUrl([formatGoogleStop(nextPoint, getPointPreview(nextPoint.pointId))], travelMode)
    : null

  if (loading) return <RouteBookDetailSkeleton />
  if (error) return (
    <div className="space-y-4">
      <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div>
      <a href="/me/routebooks" className="text-sm text-brand-600 hover:underline">返回地图列表</a>
    </div>
  )
  if (!routeBook) return null

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[30px] border border-pink-100/90 bg-[linear-gradient(150deg,rgba(255,255,255,0.95),rgba(253,242,248,0.88))] p-5 shadow-[0_22px_45px_-30px_rgba(219,39,119,0.45)] sm:p-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] [background-size:36px_36px]" />
        <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-cyan-200/50 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-40 w-40 rounded-full bg-brand-200/50 blur-3xl" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            {editingTitle ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  maxLength={100}
                  className="w-full max-w-xl rounded-xl border border-slate-300 bg-white px-3 py-2 text-lg font-semibold focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleTitleSave()
                    if (e.key === 'Escape') setEditingTitle(false)
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
                  onClick={() => void handleTitleSave()}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => { setEditingTitle(false); setTitleDraft(routeBook.title) }}
                >
                  取消
                </button>
              </div>
            ) : (
              <h1
                className="cursor-pointer text-2xl font-bold tracking-tight text-slate-900 transition hover:text-brand-600 sm:text-3xl"
                onClick={() => setEditingTitle(true)}
                title="点击编辑标题"
              >
                {routeBook.title}
              </h1>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span className={`inline-flex rounded-full border border-white/50 px-2.5 py-1 text-xs font-semibold backdrop-blur-sm ${STATUS_STYLE[routeBook.status]}`}>
                {STATUS_LABEL[routeBook.status]}
              </span>
              <span>更新于 {formatDate(routeBook.updatedAt)}</span>
            </div>
          </div>

          <a
            href="/me/routebooks"
            className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 no-underline transition hover:bg-slate-50"
          >
            返回列表
          </a>
        </div>

        <div className="relative mt-4 flex flex-wrap gap-2">
          {routeBook.status === 'draft' && (
            <button
              type="button"
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${STATUS_ACTION_CLASS.draft}`}
              onClick={() => void handleStatusChange('in_progress')}
            >
              开始巡礼
            </button>
          )}
          {routeBook.status === 'in_progress' && (
            <>
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${STATUS_ACTION_CLASS.in_progress}`}
                onClick={() => void handleStatusChange('completed')}
              >
                完成巡礼
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                onClick={() => void handleStatusChange('draft')}
              >
                回到草稿
              </button>
            </>
          )}
          {routeBook.status === 'completed' && (
            <button
              type="button"
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${STATUS_ACTION_CLASS.completed}`}
              onClick={() => void handleStatusChange('draft')}
            >
              重新编辑
            </button>
          )}
          {sorted.length > 0 && (
            <a
              href={routeGoogleUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 no-underline transition hover:bg-slate-50"
            >
              在 Google Maps 中查看路线（{NAV_MODE_LABEL[travelMode]}）
            </a>
          )}
        </div>
      </section>

      {checkInTarget && (
        <CheckInModal
          pointId={checkInTarget}
          pointName={getPointPreview(checkInTarget).title}
          onSuccess={() => {
            setCheckedInPointIds((prev) => new Set([...prev, checkInTarget]))
            setCheckInTarget(null)
            const allChecked = sorted.every((p) =>
              p.pointId === checkInTarget || checkedInPointIds.has(p.pointId)
            )
            if (allChecked) {
              void handleStatusChange('completed')
            }
          }}
          onClose={() => setCheckInTarget(null)}
        />
      )}


      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(event) => {
          void handleDragEnd(event)
        }}
      >
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">路线排序 ({sorted.length}/{SORTED_LIMIT})</h2>
            <span className="text-xs text-slate-500">按住卡片拖动排序；可直接把待排/全局点位拖入路线</span>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.95fr)]">
            <DroppablePanel
              id={SORTED_ZONE_ID}
              className="rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-sm transition"
              activeClassName="border-brand-300 bg-brand-50/35"
            >
              {sorted.length > 0 ? (
                <SortableContext items={sorted.map((point) => sortedDragId(point.id))} strategy={verticalListSortingStrategy}>
                  <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
                    {sorted.map((point) => (
                      <SortablePointCard
                        key={point.id}
                        point={point}
                        preview={getPointPreview(point.pointId)}
                        onRemove={handleRemovePoint}
                        onMoveToUnsorted={() => void handleMoveToZone(point.pointId, 'unsorted')}
                        canMoveToSorted={canAddToSorted}
                      />
                    ))}
                  </div>
                </SortableContext>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  从下方当前地图待排点或全局想去池中，直接拖拽点位到此处即可加入路线。
                </div>
              )}
            </DroppablePanel>

            <RouteSidebar
              previewEmbedUrl={previewEmbedUrl}
              focusPointEmbedUrl={focusPointEmbedUrl}
              focusPoint={focusPoint}
              focusPreview={focusPreview}
              routeBook={routeBook}
              sorted={sorted}
              checkedInPointIds={checkedInPointIds}
              travelMode={travelMode}
              setTravelMode={setTravelMode}
              routeGoogleUrl={routeGoogleUrl}
              onCheckIn={(pointId) => setCheckInTarget(pointId)}
              onStatusChange={handleStatusChange}
              getPointPreview={getPointPreview}
              hasRouteStops={hasRouteStops}
              effectiveRouteEmbedUrl={effectiveRouteEmbedUrl}
              checkedCount={checkedCount}
              allDone={allDone}
              nextPoint={nextPoint}
              nextPointNavUrl={nextPointNavUrl}
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">当前地图待排 ({unsorted.length})</h2>
            <span className="text-xs text-slate-500">直接拖拽卡片到上方路线区可加入排序；也可把路线卡片拖到此区移出路线</span>
          </div>

          <DroppablePanel
            id={UNSORTED_ZONE_ID}
            className="rounded-3xl border border-transparent p-0 transition"
            activeClassName="border-brand-300 bg-brand-50/20 p-2"
          >
            {unsorted.length > 0 ? (
              <div className="space-y-3">
                {unsorted.map((point) => (
                  <DraggableUnsortedPointCard
                    key={point.id}
                    point={point}
                    preview={getPointPreview(point.pointId)}
                    onRemove={handleRemovePoint}
                    onMoveToSorted={() => void handleMoveToZone(point.pointId, 'sorted')}
                    canMoveToSorted={canAddToSorted}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                当前地图待排为空。去<a href="/anitabi" className="text-brand-600 hover:underline">圣地地图</a>添加点位到地图。
              </div>
            )}
          </DroppablePanel>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">全局想去池 ({pointPoolItems.length})</h2>
            <span className="text-xs text-slate-500">支持把全局点位直接拖进路线区，减少按钮操作</span>
          </div>

          {pointPoolItems.length > 0 ? (
            <div className="space-y-3">
              {pointPoolItems.map((item) => {
                const preview = getPointPreview(item.pointId)
                return (
                  <DraggablePointPoolCard
                    key={item.id}
                    item={item}
                    preview={preview}
                    onAdd={() => {
                      void handleAddFromPointPool(item.pointId)
                    }}
                  />
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              全局想去池为空。去<a href="/anitabi" className="text-brand-600 hover:underline">圣地地图</a>点击“想去”来收集点位。
            </div>
          )}
        </section>
      </DndContext>

      {!canAddToSorted && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
          已排序路线已达上限 ({SORTED_LIMIT} 个点位)。如需添加新点位，请先移出部分已有点位。
        </div>
      )}
    </div>
  )
}
