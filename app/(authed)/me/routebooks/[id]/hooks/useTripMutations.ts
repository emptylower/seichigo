'use client'

import { useCallback, type MutableRefObject } from 'react'
import type {
  DayRecord,
  ItemRecord,
  LodgingRecord,
  PlaceRecord,
  RouteBookDetail,
  RouteBookStatus,
  TravelMode,
} from '../types'
import { applyReorderLocal } from '../utils'
import { apiFetch, JSON_HEADERS, sortedDayIds, stripBookUpdatedAt, type ApiFail } from './tripDataApi'
import type { UndoEntry } from './useUndoRing'
import type {
  CreateItemInput,
  LodgingInput,
  PatchBookInput,
  PlaceInput,
  UpdateItemInput,
} from './tripDataTypes'

type SetDetail = (value: RouteBookDetail | null | ((cur: RouteBookDetail | null) => RouteBookDetail | null)) => void

type MutationDeps = {
  id: string
  detailRef: MutableRefObject<RouteBookDetail | null>
  setDetail: SetDetail
  handleFailure: (result: ApiFail, prev: RouteBookDetail | null, fallback: string) => void
  pushUndo: (entry: UndoEntry) => void
  refreshPointPool: () => Promise<void>
  showToast: (message: string) => void
  load: () => Promise<void>
}

/** 所有写操作：乐观更新 + 失败回滚 + 撤销环入栈（reorder/addItem/deleteItem/optimizeDay） */
export function useTripMutations({
  id,
  detailRef,
  setDetail,
  handleFailure,
  pushUndo,
  refreshPointPool,
  showToast,
  load,
}: MutationDeps) {
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
    [detailRef, handleFailure, id, load, setDetail]
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
    [detailRef, handleFailure, id, refreshPointPool, setDetail]
  )

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
        // 服务端对同天同点位幂等（返回已有条目）：此时删掉临时条目即可
        const exists = cur.items.some((row) => row.id === item.id)
        const items = exists
          ? cur.items.filter((row) => row.id !== tempId)
          : cur.items.map((row) => (row.id === tempId ? item : row))
        return { ...cur, items, updatedAt: created.bookUpdatedAt ?? cur.updatedAt }
      })
      if (input.kind === 'point' && input.pointId) {
        // 服务端已同步点位池，本地只需移除
        refreshPointPoolSilently(refreshPointPool)
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
    [deleteItemInner, detailRef, handleFailure, id, pushUndo, refreshPointPool, setDetail]
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
    [detailRef, handleFailure, id, setDetail]
  )

  const recreateItem = useCallback(
    async (target: ItemRecord): Promise<void> => {
      const result = await apiFetch<{ item?: ItemRecord & { bookUpdatedAt?: string } }>(
        `/api/me/routebooks/${id}/items`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            dayId: target.dayId,
            kind: target.kind,
            pointId: target.pointId ?? undefined,
            placeId: target.placeId ?? undefined,
            title: target.title ?? undefined,
            note: target.note ?? undefined,
            timeStart: target.timeStart ?? undefined,
            index: target.sortOrder,
          }),
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
    [id, setDetail, showToast]
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
    [deleteItemInner, detailRef, pushUndo, recreateItem]
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
    [detailRef, handleFailure, id, setDetail]
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
            // 跨天移动：先把移入条目拉回源天，再恢复目标天内部顺序
            for (const [dayId, ids] of prevSources) {
              await reorderInner(dayId, ids)
            }
            await reorderInner(targetDayId, prevTarget)
          },
        })
      }
      return ok
    },
    [detailRef, pushUndo, reorderInner]
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
    [detailRef, handleFailure, id, pushUndo, reorderInner, setDetail, showToast]
  )

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
    [detailRef, handleFailure, id, setDetail]
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
    [detailRef, handleFailure, id, setDetail]
  )

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
    [handleFailure, id, setDetail]
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
    [handleFailure, id, setDetail]
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
    [detailRef, handleFailure, id, setDetail]
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
    [handleFailure, id, setDetail]
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
    [handleFailure, id, setDetail]
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
    [detailRef, handleFailure, id, setDetail]
  )

  return {
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
  }
}

function refreshPointPoolSilently(refreshPointPool: () => Promise<void>) {
  // 点位池同步已在服务端完成（加入即删）；本地仅做移除式刷新，失败静默
  void refreshPointPool().catch(() => undefined)
}
