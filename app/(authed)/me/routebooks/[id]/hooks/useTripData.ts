'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BangumiResponse,
  DayRecord,
  DetailResponse,
  ItemKind,
  ItemRecord,
  LodgingRecord,
  PlaceKind,
  PlaceRecord,
  PointPoolItem,
  PointPreview,
  RouteBookDetail,
  RouteBookListResponse,
  RouteBookStatus,
  RouteBookSummary,
  TravelMode,
} from '../types'
import { PREVIEW_FETCH_IDLE_TIMEOUT, PREVIEW_POINT_BATCH_SIZE } from '../types'
import {
  applyReorderLocal,
  buildFallbackPreview,
  buildPointLookupCandidates,
  isGeoPair,
  parseBangumiId,
  parsePointKey,
} from '../utils'

export type CreateItemInput = {
  kind: ItemKind
  pointId?: string
  placeId?: string
  title?: string
  note?: string
  timeStart?: string
}

export type UpdateItemInput = {
  title?: string | null
  note?: string | null
  timeStart?: string | null
  timeEnd?: string | null
  locked?: boolean
  icon?: string | null
  color?: string | null
  legMode?: TravelMode | null
}

export type PatchBookInput = {
  title?: string
  status?: RouteBookStatus
  startDate?: string | null
  dayCount?: number
}

export type PlaceInput = {
  kind: PlaceKind
  title: string
  address?: string | null
  lat: number
  lng: number
  note?: string | null
}

export type LodgingInput = {
  placeId: string
  fromDayIndex: number
  toDayIndex: number
  checkIn?: string | null
  checkOut?: string | null
  note?: string | null
}

type UndoEntry = { label: string; revert: () => Promise<void> }
const UNDO_LIMIT = 10

type ApiFail = { ok: false; status: number; error: string; reason?: string }
type ApiResult<T> = { ok: true; data: T } | ApiFail

async function apiFetch<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init)
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof data.error === 'string' ? data.error : '请求失败',
        reason: typeof data.reason === 'string' ? data.reason : undefined,
      }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, status: 0, error: '网络错误，请稍后重试' }
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function stripBookUpdatedAt<T extends { bookUpdatedAt?: string }>(row: T): Omit<T, 'bookUpdatedAt'> {
  const { bookUpdatedAt: _ignored, ...rest } = row
  return rest
}

function sortedDayIds(items: ItemRecord[], dayId: string | null): string[] {
  return items
    .filter((row) => row.dayId === dayId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => row.id)
}

export function useTripData(id: string) {
  const [detail, setDetail] = useState<RouteBookDetail | null>(null)
  const [routeBooks, setRouteBooks] = useState<RouteBookSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [pointPoolItems, setPointPoolItems] = useState<PointPoolItem[]>([])
  const [pointPreviewById, setPointPreviewById] = useState<Record<string, PointPreview>>({})
  const [checkedInPointIds, setCheckedInPointIds] = useState<Set<string>>(new Set())
  const [checkInTarget, setCheckInTarget] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])

  const detailRef = useRef<RouteBookDetail | null>(null)
  detailRef.current = detail
  const toastTimerRef = useRef<number | null>(null)

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600)
  }, [])

  // ---------------------------------------------------------------------------
  // 装载
  // ---------------------------------------------------------------------------

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

  const loadRouteBooks = useCallback(async () => {
    const result = await apiFetch<RouteBookListResponse>('/api/me/routebooks')
    if (!result.ok || 'error' in result.data) {
      setRouteBooks([])
      return
    }
    const items = Array.isArray(result.data.items) ? result.data.items : []
    setRouteBooks(
      items.filter((item): item is RouteBookSummary =>
        Boolean(item && typeof item.id === 'string' && typeof item.title === 'string')
      )
    )
  }, [])

  const refreshPointPool = useCallback(async () => {
    const result = await apiFetch<{ ok?: boolean; items?: unknown }>('/api/me/point-pool')
    if (result.ok && result.data.ok) {
      setPointPoolItems(parsePointPoolItems(result.data.items))
    }
  }, [parsePointPoolItems])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPointPreviewById({})
    setCheckedInPointIds(new Set())
    setPointPoolItems([])
    setUndoStack([])
    void loadRouteBooks()
    try {
      const rbRes = await fetch(`/api/me/routebooks/${id}`)
      const rbData = (await rbRes.json().catch(() => ({}))) as DetailResponse
      if (!rbRes.ok || 'error' in rbData) {
        setError(('error' in rbData && rbData.error) || '加载失败')
        setLoading(false)
        return
      }
      const found = rbData.routeBook || rbData.item || null
      if (!found || !Array.isArray(found.days) || !Array.isArray(found.items)) {
        setError('地图数据异常，请刷新重试')
        setLoading(false)
        return
      }
      setDetail(found)
      setTitleDraft(found.title)
      setLoading(false)

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
        }
      }
    } catch {
      setError('加载失败')
      setLoading(false)
    }
  }, [id, loadRouteBooks, parsePointPoolItems])

  useEffect(() => {
    void load()
  }, [load])

  const handleFailure = useCallback(
    (result: ApiFail, prev: RouteBookDetail | null, fallback: string) => {
      if (prev) setDetail(prev)
      if (result.reason === 'stale') {
        showToast('行程已在别处修改，已刷新')
        void load()
        return
      }
      showToast(result.error || fallback)
    },
    [load, showToast]
  )

  // ---------------------------------------------------------------------------
  // 点位预览缓存（沿用旧 hook 的分批 idle 拉取）
  // ---------------------------------------------------------------------------

  const allPointIds = useMemo(() => {
    const pointIds = [
      ...(detail?.items.map((item) => item.pointId).filter((v): v is string => Boolean(v)) ?? []),
      ...pointPoolItems.map((item) => item.pointId),
    ]
    return Array.from(new Set(pointIds))
  }, [detail, pointPoolItems])

  const unresolvedPointIds = useMemo(
    () => allPointIds.filter((pointId) => !pointPreviewById[pointId]),
    [allPointIds, pointPreviewById]
  )
  const previewFetchPointIds = useMemo(
    () => unresolvedPointIds.slice(0, PREVIEW_POINT_BATCH_SIZE),
    [unresolvedPointIds]
  )

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

  const getPointPreview = useCallback(
    (pointId: string) => pointPreviewById[pointId] || buildFallbackPreview(pointId),
    [pointPreviewById]
  )

  // ---------------------------------------------------------------------------
  // 撤销环
  // ---------------------------------------------------------------------------

  const pushUndo = useCallback((entry: UndoEntry) => {
    setUndoStack((prev) => [...prev.slice(-(UNDO_LIMIT - 1)), entry])
  }, [])

  const undo = useCallback(async () => {
    const entry = undoStack[undoStack.length - 1]
    if (!entry) return
    setUndoStack((prev) => prev.slice(0, -1))
    await entry.revert()
  }, [undoStack])

  const undoLabel = undoStack.length ? undoStack[undoStack.length - 1]!.label : null

  // ---------------------------------------------------------------------------
  // 行程本
  // ---------------------------------------------------------------------------

  const patchBook = useCallback(
    async (input: PatchBookInput): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({
        ...prev,
        title: input.title ?? prev.title,
        status: input.status ?? prev.status,
        startDate: input.startDate !== undefined ? input.startDate : prev.startDate,
        dayCount: input.dayCount ?? prev.dayCount,
      })
      const result = await apiFetch<{ routeBook?: Partial<RouteBookDetail> }>(`/api/me/routebooks/${id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...input, updatedAt: prev.updatedAt }),
      })
      if (!result.ok) {
        handleFailure(result, prev, '保存失败')
        return false
      }
      if (input.startDate !== undefined || input.dayCount !== undefined) {
        // 服务端会重算各天 date / 补建天，整份重拉
        await load()
        return true
      }
      const updated = result.data.routeBook
      setDetail((cur) =>
        cur
          ? {
              ...cur,
              title: typeof updated?.title === 'string' ? updated.title : cur.title,
              status: (updated?.status as RouteBookStatus | undefined) ?? cur.status,
              updatedAt: typeof updated?.updatedAt === 'string' ? updated.updatedAt : cur.updatedAt,
            }
          : cur
      )
      return true
    },
    [handleFailure, id, load]
  )

  async function handleTitleSave() {
    const title = titleDraft.trim()
    if (!title || !detailRef.current || title === detailRef.current.title) {
      setEditingTitle(false)
      return
    }
    await patchBook({ title })
    setEditingTitle(false)
  }

  // ---------------------------------------------------------------------------
  // 条目
  // ---------------------------------------------------------------------------

  const addItem = useCallback(
    async (dayId: string | null, input: CreateItemInput, index?: number): Promise<string | null> => {
      const prev = detailRef.current
      if (!prev) return null

      const tempId = `temp-${crypto.randomUUID()}`
      const siblings = prev.items.filter((row) => row.dayId === dayId)
      const tempItem: ItemRecord = {
        id: tempId,
        routeBookId: prev.id,
        dayId,
        sortOrder: index ?? siblings.length,
        kind: input.kind,
        pointId: input.pointId ?? null,
        placeId: input.placeId ?? null,
        title: input.title ?? null,
        note: input.note ?? null,
        timeStart: input.timeStart ?? null,
        timeEnd: null,
        locked: false,
        icon: null,
        color: null,
        legMode: null,
        payload: null,
        createdAt: new Date().toISOString(),
      }
      setDetail({ ...prev, items: [...prev.items, tempItem] })

      const result = await apiFetch<{ item?: ItemRecord & { bookUpdatedAt?: string } }>(
        `/api/me/routebooks/${id}/items`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ dayId, ...input, index }),
        }
      )
      if (!result.ok || !result.data.item) {
        handleFailure(result.ok === false ? result : { ok: false, status: 500, error: '添加失败' }, prev, '添加失败')
        return null
      }

      const created = result.data.item
      const item = stripBookUpdatedAt(created)
      setDetail((cur) => {
        if (!cur) return cur
        const exists = cur.items.some((row) => row.id === item.id)
        const items = exists
          ? cur.items.filter((row) => row.id !== tempId)
          : cur.items.map((row) => (row.id === tempId ? item : row))
        return { ...cur, items, updatedAt: created.bookUpdatedAt ?? cur.updatedAt }
      })
      if (input.kind === 'point' && input.pointId) {
        setPointPoolItems((prevPool) => prevPool.filter((row) => row.pointId !== input.pointId))
      }
      const createdId = item.id
      pushUndo({
        label: '添加条目',
        revert: async () => {
          await deleteItemInner(createdId)
        },
      })
      return item.id
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleFailure, id, pushUndo]
  )

  const updateItem = useCallback(
    async (itemId: string, data: UpdateItemInput): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      const optimistic = prev.items.map((row) => {
        if (row.id !== itemId) return row
        const next = { ...row }
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) {
            ;(next as Record<string, unknown>)[key] = value
          }
        }
        return next
      })
      setDetail({ ...prev, items: optimistic })

      const result = await apiFetch<{ item?: ItemRecord & { bookUpdatedAt?: string } }>(
        `/api/me/routebooks/${id}/items/${itemId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(data) }
      )
      if (!result.ok) {
        handleFailure(result, prev, '保存失败')
        return false
      }
      const updated = result.data.item
      if (updated) {
        const item = stripBookUpdatedAt(updated)
        setDetail((cur) =>
          cur
            ? {
                ...cur,
                items: cur.items.map((row) => (row.id === itemId ? item : row)),
                updatedAt: updated.bookUpdatedAt ?? cur.updatedAt,
              }
            : cur
        )
      }
      return true
    },
    [handleFailure, id]
  )

  const deleteItemInner = useCallback(
    async (itemId: string): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({ ...prev, items: prev.items.filter((row) => row.id !== itemId) })
      const result = await apiFetch<{ ok?: boolean }>(`/api/me/routebooks/${id}/items/${itemId}`, {
        method: 'DELETE',
      })
      if (!result.ok) {
        handleFailure(result, prev, '删除失败')
        return false
      }
      void refreshPointPool()
      return true
    },
    [handleFailure, id, refreshPointPool]
  )

  const recreateItem = useCallback(
    async (target: ItemRecord): Promise<void> => {
      const input: CreateItemInput = {
        kind: target.kind,
        pointId: target.pointId ?? undefined,
        placeId: target.placeId ?? undefined,
        title: target.title ?? undefined,
        note: target.note ?? undefined,
        timeStart: target.timeStart ?? undefined,
      }
      const result = await apiFetch<{ item?: ItemRecord & { bookUpdatedAt?: string } }>(
        `/api/me/routebooks/${id}/items`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ dayId: target.dayId, ...input, index: target.sortOrder }),
        }
      )
      if (!result.ok || !result.data.item) {
        showToast(result.ok === false ? result.error : '恢复失败')
        return
      }
      const created = result.data.item
      const item = stripBookUpdatedAt(created)
      setDetail((cur) =>
        cur && !cur.items.some((row) => row.id === item.id)
          ? { ...cur, items: [...cur.items, item], updatedAt: created.bookUpdatedAt ?? cur.updatedAt }
          : cur
      )
    },
    [id, showToast]
  )

  const deleteItem = useCallback(
    async (itemId: string): Promise<boolean> => {
      const target = detailRef.current?.items.find((row) => row.id === itemId)
      const ok = await deleteItemInner(itemId)
      if (ok && target) {
        pushUndo({
          label: '删除条目',
          revert: async () => {
            await recreateItem(target)
          },
        })
      }
      return ok
    },
    [deleteItemInner, pushUndo, recreateItem]
  )

  const reorderInner = useCallback(
    async (targetDayId: string | null, orderedItemIds: string[]): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({ ...prev, items: applyReorderLocal(prev.items, targetDayId, orderedItemIds) })
      const result = await apiFetch<{ items?: ItemRecord[]; updatedAt?: string }>(
        `/api/me/routebooks/${id}/items/reorder`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ dayId: targetDayId, orderedItemIds }),
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, '排序失败')
        return false
      }
      const data = result.data
      setDetail((cur) =>
        cur
          ? {
              ...cur,
              items: Array.isArray(data.items) ? data.items : cur.items,
              updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : cur.updatedAt,
            }
          : cur
      )
      return true
    },
    [handleFailure, id]
  )

  const reorder = useCallback(
    async (targetDayId: string | null, orderedItemIds: string[]): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      const byId = new Map(prev.items.map((row) => [row.id, row]))
      const movedIn = orderedItemIds.filter((itemId) => {
        const found = byId.get(itemId)
        return found && found.dayId !== targetDayId
      })
      const sourceDays = new Set(movedIn.map((itemId) => byId.get(itemId)!.dayId))
      const prevTarget = sortedDayIds(prev.items, targetDayId)
      const prevSources = new Map([...sourceDays].map((dayId) => [dayId, sortedDayIds(prev.items, dayId)]))

      const ok = await reorderInner(targetDayId, orderedItemIds)
      if (ok) {
        pushUndo({
          label: '调整顺序',
          revert: async () => {
            for (const [dayId, ids] of prevSources) {
              await reorderInner(dayId, ids)
            }
            await reorderInner(targetDayId, prevTarget)
          },
        })
      }
      return ok
    },
    [pushUndo, reorderInner]
  )

  const optimizeDay = useCallback(
    async (dayId: string): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      const beforeIds = sortedDayIds(prev.items, dayId)
      const result = await apiFetch<{
        items?: ItemRecord[]
        updatedAt?: string
        distanceBeforeM?: number
        distanceAfterM?: number
      }>(`/api/me/routebooks/${id}/days/${dayId}/optimize`, { method: 'POST' })
      if (!result.ok) {
        handleFailure(result, null, '优化失败')
        return false
      }
      const data = result.data
      setDetail((cur) =>
        cur
          ? {
              ...cur,
              items: Array.isArray(data.items) ? data.items : cur.items,
              updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : cur.updatedAt,
            }
          : cur
      )
      pushUndo({
        label: '优化顺序',
        revert: async () => {
          await reorderInner(dayId, beforeIds)
        },
      })
      const saved =
        typeof data.distanceBeforeM === 'number' && typeof data.distanceAfterM === 'number'
          ? Math.max(0, Math.round((data.distanceBeforeM - data.distanceAfterM) / 100) / 10)
          : 0
      showToast(saved > 0 ? `已按最短路线重排，少走约 ${saved} 公里` : '已按最短路线重排这一天')
      return true
    },
    [handleFailure, id, pushUndo, reorderInner, showToast]
  )

  // ---------------------------------------------------------------------------
  // 天
  // ---------------------------------------------------------------------------

  const insertDay = useCallback(
    async (afterDayIndex: number): Promise<boolean> => {
      const result = await apiFetch<{ day?: DayRecord & { bookUpdatedAt?: string } }>(
        `/api/me/routebooks/${id}/days`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ afterDayIndex }) }
      )
      if (!result.ok) {
        handleFailure(result, null, '添加失败')
        return false
      }
      await load()
      return true
    },
    [handleFailure, id, load]
  )

  const updateDay = useCallback(
    async (dayId: string, data: { title?: string | null; defaultTravelMode?: TravelMode }): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({
        ...prev,
        days: prev.days.map((row) => (row.id === dayId ? { ...row, ...data } : row)),
      })
      const result = await apiFetch<{ day?: DayRecord & { bookUpdatedAt?: string } }>(
        `/api/me/routebooks/${id}/days/${dayId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(data) }
      )
      if (!result.ok) {
        handleFailure(result, prev, '保存失败')
        return false
      }
      return true
    },
    [handleFailure, id]
  )

  const deleteDay = useCallback(
    async (dayId: string): Promise<boolean> => {
      const result = await apiFetch<{ ok?: boolean }>(`/api/me/routebooks/${id}/days/${dayId}`, {
        method: 'DELETE',
      })
      if (!result.ok) {
        handleFailure(result, null, '删除失败')
        return false
      }
      await load()
      return true
    },
    [handleFailure, id, load]
  )

  const reorderDays = useCallback(
    async (orderedDayIds: string[]): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      const byId = new Map(prev.days.map((row) => [row.id, row]))
      const optimistic = orderedDayIds
        .map((dayId, index) => {
          const found = byId.get(dayId)
          return found ? { ...found, dayIndex: index + 1 } : null
        })
        .filter((row): row is DayRecord => row !== null)
      setDetail({ ...prev, days: optimistic })
      const result = await apiFetch<{ days?: DayRecord[] }>(`/api/me/routebooks/${id}/days/reorder`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ orderedDayIds }),
      })
      if (!result.ok) {
        handleFailure(result, prev, '排序失败')
        return false
      }
      if (Array.isArray(result.data.days)) {
        setDetail((cur) => (cur ? { ...cur, days: result.data.days! } : cur))
      }
      return true
    },
    [handleFailure, id]
  )

  // ---------------------------------------------------------------------------
  // 自定义点 / 住宿
  // ---------------------------------------------------------------------------

  const createPlace = useCallback(
    async (input: PlaceInput): Promise<string | null> => {
      const result = await apiFetch<{ place?: PlaceRecord & { bookUpdatedAt?: string } }>(
        `/api/me/routebooks/${id}/places`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok || !result.data.place) {
        handleFailure(result.ok === false ? result : { ok: false, status: 500, error: '添加失败' }, null, '添加失败')
        return null
      }
      const place = stripBookUpdatedAt(result.data.place)
      setDetail((cur) => (cur ? { ...cur, places: [...cur.places, place] } : cur))
      return place.id
    },
    [handleFailure, id]
  )

  const updatePlace = useCallback(
    async (placeId: string, input: Partial<PlaceInput>): Promise<boolean> => {
      const result = await apiFetch<{ place?: PlaceRecord & { bookUpdatedAt?: string } }>(
        `/api/me/routebooks/${id}/places/${placeId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok) {
        handleFailure(result, null, '保存失败')
        return false
      }
      const place = result.data.place ? stripBookUpdatedAt(result.data.place) : null
      if (place) {
        setDetail((cur) =>
          cur ? { ...cur, places: cur.places.map((row) => (row.id === placeId ? place : row)) } : cur
        )
      }
      return true
    },
    [handleFailure, id]
  )

  const deletePlace = useCallback(
    async (placeId: string): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({
        ...prev,
        places: prev.places.filter((row) => row.id !== placeId),
        items: prev.items.filter((row) => row.placeId !== placeId),
        lodgings: prev.lodgings.filter((row) => row.placeId !== placeId),
      })
      const result = await apiFetch<{ ok?: boolean }>(`/api/me/routebooks/${id}/places/${placeId}`, {
        method: 'DELETE',
      })
      if (!result.ok) {
        handleFailure(result, prev, '删除失败')
        return false
      }
      return true
    },
    [handleFailure, id]
  )

  const createLodging = useCallback(
    async (input: LodgingInput): Promise<string | null> => {
      const result = await apiFetch<{ lodging?: LodgingRecord & { bookUpdatedAt?: string } }>(
        `/api/me/routebooks/${id}/lodgings`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok || !result.data.lodging) {
        handleFailure(result.ok === false ? result : { ok: false, status: 500, error: '添加失败' }, null, '添加失败')
        return null
      }
      const lodging = stripBookUpdatedAt(result.data.lodging)
      setDetail((cur) => (cur ? { ...cur, lodgings: [...cur.lodgings, lodging] } : cur))
      return lodging.id
    },
    [handleFailure, id]
  )

  const updateLodging = useCallback(
    async (lodgingId: string, input: Partial<LodgingInput>): Promise<boolean> => {
      const result = await apiFetch<{ lodging?: LodgingRecord & { bookUpdatedAt?: string } }>(
        `/api/me/routebooks/${id}/lodgings/${lodgingId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok) {
        handleFailure(result, null, '保存失败')
        return false
      }
      const lodging = result.data.lodging ? stripBookUpdatedAt(result.data.lodging) : null
      if (lodging) {
        setDetail((cur) =>
          cur ? { ...cur, lodgings: cur.lodgings.map((row) => (row.id === lodgingId ? lodging : row)) } : cur
        )
      }
      return true
    },
    [handleFailure, id]
  )

  const deleteLodging = useCallback(
    async (lodgingId: string): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({ ...prev, lodgings: prev.lodgings.filter((row) => row.id !== lodgingId) })
      const result = await apiFetch<{ ok?: boolean }>(`/api/me/routebooks/${id}/lodgings/${lodgingId}`, {
        method: 'DELETE',
      })
      if (!result.ok) {
        handleFailure(result, prev, '删除失败')
        return false
      }
      return true
    },
    [handleFailure, id]
  )

  // ---------------------------------------------------------------------------
  // 打卡
  // ---------------------------------------------------------------------------

  const markPointCheckedIn = useCallback(
    (pointId: string) => {
      setCheckedInPointIds((prev) => {
        if (prev.has(pointId)) return prev
        return new Set([...prev, pointId])
      })
      const cur = detailRef.current
      if (!cur) return
      const pointItems = cur.items.filter((row) => row.kind === 'point' && row.pointId)
      const allChecked = pointItems.every(
        (row) => row.pointId === pointId || checkedInPointIds.has(row.pointId!)
      )
      if (allChecked && pointItems.length > 0) {
        void patchBook({ status: 'completed' })
      }
    },
    [checkedInPointIds, patchBook]
  )

  const unmarkPointCheckedIn = useCallback(
    async (pointId: string): Promise<boolean> => {
      const res = await fetch('/api/me/point-states', {
        method: 'DELETE',
        headers: JSON_HEADERS,
        body: JSON.stringify({ pointId }),
      })
      if (!res.ok) return false
      setCheckedInPointIds((prev) => {
        if (!prev.has(pointId)) return prev
        const next = new Set(prev)
        next.delete(pointId)
        return next
      })
      if (detailRef.current?.status === 'completed') {
        await patchBook({ status: 'in_progress' })
      }
      return true
    },
    [patchBook]
  )

  function handleCheckInSuccess() {
    if (!checkInTarget) return
    markPointCheckedIn(checkInTarget)
    setCheckInTarget(null)
  }

  return {
    detail,
    routeBooks,
    loading,
    error,
    toast,
    reload: load,

    pointPoolItems,
    getPointPreview,
    refreshPointPool,

    checkedInPointIds,
    checkInTarget,
    setCheckInTarget,
    handleCheckInSuccess,
    unmarkPointCheckedIn,

    editingTitle,
    setEditingTitle,
    titleDraft,
    setTitleDraft,
    handleTitleSave,
    patchBook,

    addItem,
    updateItem,
    deleteItem,
    reorder,
    optimizeDay,

    insertDay,
    updateDay,
    deleteDay,
    reorderDays,

    createPlace,
    updatePlace,
    deletePlace,
    createLodging,
    updateLodging,
    deleteLodging,

    undo,
    undoLabel,
    undoCount: undoStack.length,
  }
}
