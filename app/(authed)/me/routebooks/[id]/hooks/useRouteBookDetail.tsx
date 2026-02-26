'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import type {
  PointRecord,
  PointPoolItem,
  RouteBookDetail,
  DetailResponse,
  PointPreview,
  BangumiResponse,
  NavMode,
  RouteBookStatus,
} from '../types'
import {
  SORTED_LIMIT,
  SORTED_ZONE_ID,
  SORTED_DND_PREFIX,
  POOL_DND_PREFIX,
  PREVIEW_POINT_BATCH_SIZE,
  PREVIEW_FETCH_IDLE_TIMEOUT,
  ROUTE_PREVIEW_URL_SYNC_DEBOUNCE_MS,
} from '../types'
import {
  isPointRecord,
  getSortedPoints,
  rebuildPoints,
  reorderSortedInPoints,
  addPointToZoneInPoints,
  formatGoogleStop,
  buildGoogleDirectionsEmbedUrl,
  buildGoogleLegDirectionsUrl,
  buildGooglePointEmbedUrl,
  parseBangumiId,
  parsePointKey,
  buildPointLookupCandidates,
  buildFallbackPreview,
  isGeoPair,
  sortedDragId,
  parseDragRecordId,
} from '../utils'
import {
  PointCard,
  PointPoolCard,
} from '../components/PointCard'

export function useRouteBookDetail(id: string) {
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
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
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
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
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

  function markPointCheckedIn(pointId: string) {
    setCheckedInPointIds((prev) => {
      if (prev.has(pointId)) return prev
      return new Set([...prev, pointId])
    })

    const allChecked = sorted.every((p) => p.pointId === pointId || checkedInPointIds.has(p.pointId))
    if (allChecked) {
      void handleStatusChange('completed')
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
        return { ...prev, points: rebuildPoints(nextSorted, []) }
      })
      void refreshPointPool()
    }
  }

  async function handleAddFromPointPool(
    pointId: string,
    targetZone: 'sorted' = 'sorted',
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

    // Flow 1: Sorted → Sorted (reorder)
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

    // Flow 2: Pool → Sorted (add)
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

  const renderDragOverlay = (dragId: string) => {
    const sortedRecordId = parseDragRecordId(dragId, SORTED_DND_PREFIX)
    if (sortedRecordId) {
      const point = sorted.find((p) => p.id === sortedRecordId)
      if (!point) return null
      const preview = getPointPreview(point.pointId)
      return <PointCard point={point} preview={preview} onRemove={() => {}} canMoveToSorted={false} isDragging />
    }
    const poolItemId = parseDragRecordId(dragId, POOL_DND_PREFIX)
    if (poolItemId) {
      const item = pointPoolItems.find((i) => i.id === poolItemId)
      if (!item) return null
      const preview = getPointPreview(item.pointId)
      return <PointPoolCard item={item} preview={preview} onAdd={() => {}} isDragging />
    }
    return null
  }

  function handleCheckInSuccess() {
    if (!checkInTarget) return
    markPointCheckedIn(checkInTarget)
    setCheckInTarget(null)
  }

  return {
    // State
    routeBook,
    loading,
    error,
    editingTitle,
    setEditingTitle,
    titleDraft,
    setTitleDraft,
    checkedInPointIds,
    setCheckedInPointIds,
    checkInTarget,
    setCheckInTarget,
    travelMode,
    setTravelMode,
    pointPoolItems,
    activeDragId,
    setActiveDragId,

    // Computed
    sorted,
    canAddToSorted,
    hasRouteStops,
    effectiveRouteEmbedUrl,
    focusPoint,
    focusPreview,
    focusPointEmbedUrl,
    previewEmbedUrl,
    checkedCount,
    allDone,
    nextPoint,
    routeLegs,
    sortedStops,

    // Handlers
    handleTitleSave,
    handleStatusChange,
    handleRemovePoint,
    handleAddFromPointPool,
    handleDragEnd,
    handleCheckInSuccess,
    markPointCheckedIn,
    getPointPreview,
    renderDragOverlay,

    // DnD
    sensors,
  }
}
