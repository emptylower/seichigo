'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DetailResponse,
  PointPoolItem,
  RouteBookDetail,
  RouteBookListResponse,
  RouteBookSummary,
} from '../types'
import { apiFetch, JSON_HEADERS, type ApiFail } from './tripDataApi'
import { usePointPreviews } from './usePointPreviews'
import { useUndoRing } from './useUndoRing'
import { useTripMutations } from './useTripMutations'

export type {
  CreateItemInput,
  LodgingInput,
  PatchBookInput,
  PlaceInput,
  UpdateItemInput,
} from './tripDataTypes'

export function useTripData(id: string) {
  const [detail, setDetail] = useState<RouteBookDetail | null>(null)
  const [routeBooks, setRouteBooks] = useState<RouteBookSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [pointPoolItems, setPointPoolItems] = useState<PointPoolItem[]>([])
  const [checkedInPointIds, setCheckedInPointIds] = useState<Set<string>>(new Set())
  const [checkInTarget, setCheckInTarget] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

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

  const undoRing = useUndoRing()
  // useUndoRing 每次渲染返回新对象，load 只能依赖稳定的 clear（useCallback 空依赖）
  const clearUndo = undoRing.clear

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setCheckedInPointIds(new Set())
    setPointPoolItems([])
    clearUndo()
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
  }, [id, loadRouteBooks, parsePointPoolItems, clearUndo])

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
  // 预览 / 写操作
  // ---------------------------------------------------------------------------

  const allPointIds = useMemo(() => {
    const pointIds = [
      ...(detail?.items.map((item) => item.pointId).filter((v): v is string => Boolean(v)) ?? []),
      ...pointPoolItems.map((item) => item.pointId),
    ]
    return Array.from(new Set(pointIds))
  }, [detail, pointPoolItems])

  const { getPointPreview, resetPreviews } = usePointPreviews(allPointIds)

  // 整份重载时清空预览缓存（load 内部不直接调，避免循环依赖）
  const reload = useCallback(async () => {
    resetPreviews()
    await load()
  }, [load, resetPreviews])

  const mutations = useTripMutations({
    id,
    detailRef,
    setDetail,
    handleFailure,
    pushUndo: undoRing.push,
    refreshPointPool,
    showToast,
    load,
  })
  const { patchBook } = mutations

  // ---------------------------------------------------------------------------
  // 标题 / 点位池 / 打卡
  // ---------------------------------------------------------------------------

  async function handleTitleSave() {
    const title = titleDraft.trim()
    if (!title || !detailRef.current || title === detailRef.current.title) {
      setEditingTitle(false)
      return
    }
    await patchBook({ title })
    setEditingTitle(false)
  }

  const removeFromPool = useCallback(
    async (pointId: string): Promise<boolean> => {
      const res = await fetch('/api/me/point-pool', {
        method: 'DELETE',
        headers: JSON_HEADERS,
        body: JSON.stringify({ pointId }),
      })
      if (!res.ok) {
        showToast('从点位池删除失败')
        return false
      }
      setPointPoolItems((prev) => prev.filter((item) => item.pointId !== pointId))
      return true
    },
    [showToast]
  )

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
    showToast,
    reload,

    pointPoolItems,
    getPointPreview,
    refreshPointPool,
    removeFromPool,

    checkedInPointIds,
    checkInTarget,
    setCheckInTarget,
    handleCheckInSuccess,
    markPointCheckedIn,
    unmarkPointCheckedIn,

    editingTitle,
    setEditingTitle,
    titleDraft,
    setTitleDraft,
    handleTitleSave,

    ...mutations,

    undo: undoRing.undo,
    undoLabel: undoRing.undoLabel,
    undoCount: undoRing.undoCount,
  }
}
