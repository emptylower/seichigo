'use client'

import { useCallback, useRef, type MutableRefObject } from 'react'
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
import type { SupportedLocale } from '@/lib/i18n/types'
import { tr } from '../../i18n'
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
  locale?: SupportedLocale
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
  locale = 'zh',
}: MutationDeps) {
  const localeRef = useRef(locale)
  localeRef.current = locale
  const api = useCallback(
    <T,>(url: string, init?: RequestInit) => apiFetch<T>(url, init, localeRef.current),
    []
  )
  // 契约：所有写接口响应带顶层 bookUpdatedAt；仅 patchBook 携带 updatedAt 乐观锁
  const applyBookUpdatedAt = useCallback(
    (value: unknown) => {
      if (typeof value !== 'string') return
      setDetail((cur) => (cur ? { ...cur, updatedAt: value } : cur))
    },
    [setDetail]
  )

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
      const result = await api<{ routeBook?: Partial<RouteBookDetail>; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}`,
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ ...input, updatedAt: prev.updatedAt }),
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.saveFailed', localeRef.current))
        return false
      }
      if (input.startDate !== undefined || input.dayCount !== undefined) {
        // 服务端会重算各天 date / 补建天，整份重拉
        await load()
        return true
      }
      const updated = result.data.routeBook
      const bookUpdatedAt = result.data.bookUpdatedAt
      setDetail((cur) =>
        cur
          ? {
              ...cur,
              title: typeof updated?.title === 'string' ? updated.title : cur.title,
              status: (updated?.status as RouteBookStatus | undefined) ?? cur.status,
              updatedAt:
                typeof bookUpdatedAt === 'string'
                  ? bookUpdatedAt
                  : typeof updated?.updatedAt === 'string'
                    ? updated.updatedAt
                    : cur.updatedAt,
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
      const result = await api<{ ok?: boolean; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/items/${itemId}`,
        {
          method: 'DELETE',
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.deleteFailed', localeRef.current))
        return false
      }
      applyBookUpdatedAt(result.data.bookUpdatedAt)
      void refreshPointPool()
      return true
    },
    [applyBookUpdatedAt, detailRef, handleFailure, id, refreshPointPool, setDetail]
  )

  const addItem = useCallback(
    async (dayId: string | null, input: CreateItemInput, index?: number): Promise<string | null> => {
      const prev = detailRef.current
      if (!prev) return null

      const tempId = `temp-${crypto.randomUUID()}`
      const siblings = prev.items.filter((row) => row.dayId === dayId)
      const insertAt = index ?? siblings.length
      const tempItem: ItemRecord = {
        id: tempId,
        routeBookId: prev.id,
        dayId,
        sortOrder: insertAt,
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
      // 插入位置之后的同天兄弟本地顺移 sortOrder，保持乐观顺序与服务端重编一致
      const optimistic = prev.items.map((row) =>
        row.dayId === dayId && row.sortOrder >= insertAt ? { ...row, sortOrder: row.sortOrder + 1 } : row
      )
      setDetail({ ...prev, items: [...optimistic, tempItem] })

      const result = await api<{
        item?: ItemRecord & { bookUpdatedAt?: string }
        items?: ItemRecord[]
        bookUpdatedAt?: string
      }>(`/api/me/routebooks/${id}/items`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ dayId, ...input, index }),
      })
      if (!result.ok || !result.data.item) {
        handleFailure(result.ok === false ? result : { ok: false, status: 500, error: tr('routebook.detail.addFailed', localeRef.current) }, prev, tr('routebook.detail.addFailed', localeRef.current))
        return null
      }

      const created = result.data.item
      const item = stripBookUpdatedAt(created)
      const serverDayItems = Array.isArray(result.data.items) ? result.data.items : null
      const bookUpdatedAt =
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : created.bookUpdatedAt
      setDetail((cur) => {
        if (!cur) return cur
        const updatedAt = bookUpdatedAt ?? cur.updatedAt
        // 契约：items 为目标天写入后的完整条目（已重编 sortOrder），整体替换该天
        if (serverDayItems) {
          const others = cur.items.filter((row) => row.dayId !== dayId)
          return { ...cur, items: [...others, ...serverDayItems], updatedAt }
        }
        // 服务端对同天同点位幂等（返回已有条目）：此时删掉临时条目即可
        const exists = cur.items.some((row) => row.id === item.id)
        const items = exists
          ? cur.items.filter((row) => row.id !== tempId)
          : cur.items.map((row) => (row.id === tempId ? item : row))
        return { ...cur, items, updatedAt }
      })
      if (input.kind === 'point' && input.pointId) {
        // 服务端已同步点位池，本地只需移除
        refreshPointPoolSilently(refreshPointPool)
      }
      const createdId = item.id
      pushUndo({
        label: tr('routebook.detail.undoAddItem', localeRef.current),
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

      const result = await api<{ item?: ItemRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/items/${itemId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(data) }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.saveFailed', localeRef.current))
        return false
      }
      const updated = result.data.item
      const bookUpdatedAt =
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : updated?.bookUpdatedAt
      if (updated) {
        const item = stripBookUpdatedAt(updated)
        setDetail((cur) =>
          cur
            ? {
                ...cur,
                items: cur.items.map((row) => (row.id === itemId ? item : row)),
                updatedAt: bookUpdatedAt ?? cur.updatedAt,
              }
            : cur
        )
      } else {
        applyBookUpdatedAt(bookUpdatedAt)
      }
      return true
    },
    [applyBookUpdatedAt, detailRef, handleFailure, id, setDetail]
  )

  const recreateItem = useCallback(
    async (target: ItemRecord): Promise<void> => {
      // createItemSchema 只接收部分字段（payload 由服务端管，不传）；
      // locked/timeEnd/icon/color/legMode 建后补 PATCH 还原，避免撤销丢字段
      const result = await api<{
        item?: ItemRecord & { bookUpdatedAt?: string }
        items?: ItemRecord[]
        bookUpdatedAt?: string
      }>(`/api/me/routebooks/${id}/items`, {
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
      })
      if (!result.ok || !result.data.item) {
        showToast(result.ok === false ? result.error : tr('routebook.detail.restoreFailed', localeRef.current))
        return
      }
      const created = result.data.item
      let item = stripBookUpdatedAt(created)
      let bookUpdatedAt =
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : created.bookUpdatedAt

      const patch: UpdateItemInput = {}
      if (target.timeEnd) patch.timeEnd = target.timeEnd
      if (target.locked) patch.locked = true
      if (target.icon) patch.icon = target.icon
      if (target.color) patch.color = target.color
      if (target.legMode) patch.legMode = target.legMode
      if (Object.keys(patch).length > 0) {
        const patchResult = await api<{ item?: ItemRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
          `/api/me/routebooks/${id}/items/${item.id}`,
          { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }
        )
        if (patchResult.ok && patchResult.data.item) {
          item = stripBookUpdatedAt(patchResult.data.item)
          bookUpdatedAt =
            typeof patchResult.data.bookUpdatedAt === 'string'
              ? patchResult.data.bookUpdatedAt
              : (patchResult.data.item.bookUpdatedAt ?? bookUpdatedAt)
        }
      }

      const serverDayItems = Array.isArray(result.data.items) ? result.data.items : null
      const finalItem = item
      const finalUpdatedAt = bookUpdatedAt
      setDetail((cur) => {
        if (!cur || cur.items.some((row) => row.id === finalItem.id)) return cur
        const updatedAt = finalUpdatedAt ?? cur.updatedAt
        if (serverDayItems) {
          const others = cur.items.filter((row) => row.dayId !== target.dayId)
          const dayItems = serverDayItems.map((row) => (row.id === finalItem.id ? finalItem : row))
          return { ...cur, items: [...others, ...dayItems], updatedAt }
        }
        return { ...cur, items: [...cur.items, finalItem], updatedAt }
      })
    },
    [id, setDetail, showToast]
  )

  const deleteItem = useCallback(
    async (itemId: string): Promise<boolean> => {
      const target = detailRef.current?.items.find((row) => row.id === itemId)
      const ok = await deleteItemInner(itemId)
      if (ok && target) {
        pushUndo({
          label: tr('routebook.detail.undoDeleteItem', localeRef.current),
          revert: async () => {
            await recreateItem(target)
          },
        })
      }
      return ok
    },
    [deleteItemInner, detailRef, pushUndo, recreateItem]
  )

  type ReorderResult = { ok: boolean; items: ItemRecord[] | null }

  const reorderInner = useCallback(
    async (targetDayId: string | null, orderedItemIds: string[]): Promise<ReorderResult> => {
      const prev = detailRef.current
      if (!prev) return { ok: false, items: null }
      setDetail({ ...prev, items: applyReorderLocal(prev.items, targetDayId, orderedItemIds) })
      const result = await api<{ items?: ItemRecord[]; bookUpdatedAt?: string; updatedAt?: string }>(
        `/api/me/routebooks/${id}/items/reorder`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ dayId: targetDayId, orderedItemIds }),
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.reorderFailed', localeRef.current))
        return { ok: false, items: null }
      }
      const data = result.data
      const nextUpdatedAt =
        typeof data.bookUpdatedAt === 'string'
          ? data.bookUpdatedAt
          : typeof data.updatedAt === 'string'
            ? data.updatedAt
            : undefined
      const serverItems = Array.isArray(data.items) ? data.items : null
      setDetail((cur) =>
        cur
          ? {
              ...cur,
              items: serverItems ?? cur.items,
              updatedAt: nextUpdatedAt ?? cur.updatedAt,
            }
          : cur
      )
      return { ok: true, items: serverItems }
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

      const res = await reorderInner(targetDayId, orderedItemIds)
      if (res.ok) {
        // 服务端可能在 reorder 时增删 transit：撤销以响应 items（整本）为准重建 id 列表，
        // 拖拽前的旧列表可能含已被服务端删掉的条目
        const serverIds = res.items ? new Set(res.items.map((row) => row.id)) : null
        const alive = (ids: string[]) => (serverIds ? ids.filter((itemId) => serverIds.has(itemId)) : ids)
        pushUndo({
          label: tr('routebook.detail.undoReorder', localeRef.current),
          revert: async () => {
            // 跨天移动：先把移入条目拉回源天，再恢复目标天内部顺序
            for (const [dayId, ids] of prevSources) {
              await reorderInner(dayId, alive(ids))
            }
            await reorderInner(targetDayId, alive(prevTarget))
          },
        })
      }
      return res.ok
    },
    [detailRef, pushUndo, reorderInner]
  )

  const optimizeDay = useCallback(
    async (dayId: string): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      const beforeIds = sortedDayIds(prev.items, dayId)
      const result = await api<{
        items?: ItemRecord[]
        bookUpdatedAt?: string
        updatedAt?: string
        distanceBeforeM?: number
        distanceAfterM?: number
      }>(`/api/me/routebooks/${id}/days/${dayId}/optimize`, { method: 'POST' })
      if (!result.ok) {
        handleFailure(result, null, tr('routebook.detail.optimizeFailed', localeRef.current))
        return false
      }
      const data = result.data
      const nextUpdatedAt =
        typeof data.bookUpdatedAt === 'string'
          ? data.bookUpdatedAt
          : typeof data.updatedAt === 'string'
            ? data.updatedAt
            : undefined
      setDetail((cur) =>
        cur
          ? {
              ...cur,
              items: Array.isArray(data.items) ? data.items : cur.items,
              updatedAt: nextUpdatedAt ?? cur.updatedAt,
            }
          : cur
      )
      pushUndo({
        label: tr('routebook.detail.undoOptimize', localeRef.current),
        revert: async () => {
          await reorderInner(dayId, beforeIds)
        },
      })
      const saved =
        typeof data.distanceBeforeM === 'number' && typeof data.distanceAfterM === 'number'
          ? Math.max(0, Math.round((data.distanceBeforeM - data.distanceAfterM) / 100) / 10)
          : 0
      showToast(saved > 0 ? tr('routebook.detail.optimizeSaved', locale, { km: saved }) : tr('routebook.detail.optimizeDone', localeRef.current))
      return true
    },
    [detailRef, handleFailure, id, pushUndo, reorderInner, setDetail, showToast]
  )

  const insertDay = useCallback(
    async (afterDayIndex: number): Promise<boolean> => {
      const result = await api<{ day?: DayRecord & { bookUpdatedAt?: string } }>(
        `/api/me/routebooks/${id}/days`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ afterDayIndex }) }
      )
      if (!result.ok) {
        handleFailure(result, null, tr('routebook.detail.addFailed', localeRef.current))
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
      const result = await api<{ day?: DayRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/days/${dayId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(data) }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.saveFailed', localeRef.current))
        return false
      }
      applyBookUpdatedAt(
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : result.data.day?.bookUpdatedAt
      )
      return true
    },
    [applyBookUpdatedAt, detailRef, handleFailure, id, setDetail]
  )

  const deleteDay = useCallback(
    async (dayId: string): Promise<boolean> => {
      const result = await api<{ ok?: boolean }>(`/api/me/routebooks/${id}/days/${dayId}`, {
        method: 'DELETE',
      })
      if (!result.ok) {
        handleFailure(result, null, tr('routebook.detail.deleteFailed', localeRef.current))
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
      const result = await api<{ days?: DayRecord[]; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/days/reorder`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ orderedDayIds }),
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.reorderFailed', localeRef.current))
        return false
      }
      const serverDays = Array.isArray(result.data.days) ? result.data.days : null
      const bookUpdatedAt = result.data.bookUpdatedAt
      setDetail((cur) =>
        cur
          ? {
              ...cur,
              days: serverDays ?? cur.days,
              updatedAt: typeof bookUpdatedAt === 'string' ? bookUpdatedAt : cur.updatedAt,
            }
          : cur
      )
      return true
    },
    [detailRef, handleFailure, id, setDetail]
  )

  const createPlace = useCallback(
    async (input: PlaceInput): Promise<string | null> => {
      const result = await api<{ place?: PlaceRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/places`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok || !result.data.place) {
        handleFailure(result.ok === false ? result : { ok: false, status: 500, error: tr('routebook.detail.addFailed', localeRef.current) }, null, tr('routebook.detail.addFailed', localeRef.current))
        return null
      }
      const place = stripBookUpdatedAt(result.data.place)
      setDetail((cur) => (cur ? { ...cur, places: [...cur.places, place] } : cur))
      applyBookUpdatedAt(
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : result.data.place.bookUpdatedAt
      )
      return place.id
    },
    [applyBookUpdatedAt, handleFailure, id, setDetail]
  )

  const updatePlace = useCallback(
    async (placeId: string, input: Partial<PlaceInput>): Promise<boolean> => {
      const result = await api<{ place?: PlaceRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/places/${placeId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok) {
        handleFailure(result, null, tr('routebook.detail.saveFailed', localeRef.current))
        return false
      }
      const place = result.data.place ? stripBookUpdatedAt(result.data.place) : null
      if (place) {
        setDetail((cur) =>
          cur ? { ...cur, places: cur.places.map((row) => (row.id === placeId ? place : row)) } : cur
        )
      }
      applyBookUpdatedAt(
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : result.data.place?.bookUpdatedAt
      )
      return true
    },
    [applyBookUpdatedAt, handleFailure, id, setDetail]
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
      const result = await api<{ ok?: boolean; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/places/${placeId}`,
        {
          method: 'DELETE',
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.deleteFailed', localeRef.current))
        return false
      }
      applyBookUpdatedAt(result.data.bookUpdatedAt)
      return true
    },
    [applyBookUpdatedAt, detailRef, handleFailure, id, setDetail]
  )

  const createLodging = useCallback(
    async (input: LodgingInput): Promise<string | null> => {
      const result = await api<{ lodging?: LodgingRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/lodgings`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok || !result.data.lodging) {
        handleFailure(result.ok === false ? result : { ok: false, status: 500, error: tr('routebook.detail.addFailed', localeRef.current) }, null, tr('routebook.detail.addFailed', localeRef.current))
        return null
      }
      const lodging = stripBookUpdatedAt(result.data.lodging)
      setDetail((cur) => (cur ? { ...cur, lodgings: [...cur.lodgings, lodging] } : cur))
      applyBookUpdatedAt(
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : result.data.lodging.bookUpdatedAt
      )
      return lodging.id
    },
    [applyBookUpdatedAt, handleFailure, id, setDetail]
  )

  const updateLodging = useCallback(
    async (lodgingId: string, input: Partial<LodgingInput>): Promise<boolean> => {
      const result = await api<{ lodging?: LodgingRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/lodgings/${lodgingId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok) {
        handleFailure(result, null, tr('routebook.detail.saveFailed', localeRef.current))
        return false
      }
      const lodging = result.data.lodging ? stripBookUpdatedAt(result.data.lodging) : null
      if (lodging) {
        setDetail((cur) =>
          cur ? { ...cur, lodgings: cur.lodgings.map((row) => (row.id === lodgingId ? lodging : row)) } : cur
        )
      }
      applyBookUpdatedAt(
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : result.data.lodging?.bookUpdatedAt
      )
      return true
    },
    [applyBookUpdatedAt, handleFailure, id, setDetail]
  )

  const deleteLodging = useCallback(
    async (lodgingId: string): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({ ...prev, lodgings: prev.lodgings.filter((row) => row.id !== lodgingId) })
      const result = await api<{ ok?: boolean; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/lodgings/${lodgingId}`,
        {
          method: 'DELETE',
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.deleteFailed', localeRef.current))
        return false
      }
      applyBookUpdatedAt(result.data.bookUpdatedAt)
      return true
    },
    [applyBookUpdatedAt, detailRef, handleFailure, id, setDetail]
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
